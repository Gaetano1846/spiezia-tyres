// GLS Italy SDK — port interno della Cloud Function `gls-italy` (crm-3iuocs).
//
// Porting 1:1 della logica originale. Le UNICHE differenze rispetto alla CF sono
// gli adattatori di I/O:
//   • Firestore  → adminDb()        (firebase-admin, al posto di @google-cloud/firestore)
//   • Storage    → adminStorage()   (firebase-admin, stesso bucket crm-3iuocs.appspot.com)
//   • HTTP a GLS → fetch            (al posto di axios)
//   • Entry HTTP → processGlsAction(body)  (al posto di functions.http)
//
// Tutta la logica GLS (SOAP/XML, mappe paesi/province, COD, internazionale vs
// domestico, calcolo colli/peso, merge PDF, generazione ZPL) è invariata.

import { Timestamp } from "firebase-admin/firestore";
import { PDFDocument } from "pdf-lib";
import xml2js from "xml2js";
import { adminDb, adminStorage } from "../firebase-admin";

// GLS Italy API endpoint
const GLS_WEB_SERVICE_URL = "https://labelservice.gls-italy.com/ilswebservice.asmx";

// Bucket Storage (identico a quello hardcoded nella CF originale)
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "crm-3iuocs.appspot.com";

// Credenziali GLS per contratto (0 = Nola, 1 = Roma) — lette dalle env del server.
function getAuthByContract(contractIndex = 0) {
  const contracts = {
    0: {
      branchId: process.env.GLS_BRANCH_ID,
      clientId: process.env.GLS_CLIENT_ID,
      password: process.env.GLS_PASSWORD,
      contractId: process.env.GLS_CONTRACT_ID,
    },
    1: {
      branchId: process.env.GLS2_BRANCH_ID,
      clientId: process.env.GLS2_CLIENT_ID,
      password: process.env.GLS2_PASSWORD,
      contractId: process.env.GLS2_CONTRACT_ID,
    },
  };

  const auth = contracts[contractIndex];
  if (!auth) {
    throw new Error(`Invalid contract index: ${contractIndex}. Available contracts: 0, 1`);
  }

  const suffix = contractIndex === 0 ? "" : "2";
  const missing = [];
  if (!auth.branchId) missing.push(`GLS${suffix}_BRANCH_ID`);
  if (!auth.clientId) missing.push(`GLS${suffix}_CLIENT_ID`);
  if (!auth.password) missing.push(`GLS${suffix}_PASSWORD`);
  if (!auth.contractId) missing.push(`GLS${suffix}_CONTRACT_ID`);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for contract ${contractIndex}: ${missing.join(", ")}`);
  }

  console.log(`Using GLS contract ${contractIndex}: Branch ${auth.branchId}, Client ${auth.clientId}, Contract ${auth.contractId}`);
  return auth;
}

// Format a JS Date into dd/MM/yyyy
function formatDateDDMMYYYY(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Helper: get contract index from order document
async function getContractIndexFromOrder(ordiniId) {
  const firestore = adminDb();
  try {
    const orderDoc = await firestore.collection("Ordini").doc(ordiniId).get();
    if (!orderDoc.exists) {
      throw new Error(`Order ${ordiniId} not found`);
    }
    const orderData = orderDoc.data();
    const contractIndex = orderData.GLS_ContractIndex;
    if (contractIndex === undefined || contractIndex === null) {
      console.warn(`No GLS_ContractIndex found in order ${ordiniId}, defaulting to contract 0`);
      return 0;
    }
    console.log(`Retrieved contract index ${contractIndex} from order ${ordiniId}`);
    return contractIndex;
  } catch (error) {
    console.error(`Error retrieving contract index from order ${ordiniId}:`, error.message);
    throw error;
  }
}

// Helper: get contract index from multiple orders (first valid found)
async function getContractIndexFromOrders(ordiniIds) {
  for (const ordiniId of ordiniIds) {
    try {
      const contractIndex = await getContractIndexFromOrder(ordiniId);
      console.log(`Using contract index ${contractIndex} from first valid order ${ordiniId}`);
      return contractIndex;
    } catch (error) {
      console.warn(`Could not get contract index from order ${ordiniId}: ${error.message}`);
      continue;
    }
  }
  console.warn("No valid contract index found from any order, defaulting to contract 0");
  return 0;
}

// Create a Spedizioni doc for each newly added parcel
async function createSpedizioniEntries(parcelResults) {
  const firestore = adminDb();
  const dataString = formatDateDDMMYYYY(new Date());
  const batch = firestore.batch();

  for (const pr of parcelResults) {
    const ref = firestore.collection("Spedizioni").doc(pr.parcelId);
    const orderReference = pr.orderRef ? firestore.collection("Ordini").doc(pr.orderRef) : null;

    // Resolve Source from Ordini document, fallback to 'GLS'
    let sourceVal = "GLS";
    if (pr.orderRef) {
      try {
        const ordSnap = await firestore.collection("Ordini").doc(String(pr.orderRef)).get();
        if (ordSnap.exists) {
          const od = ordSnap.data() || {};
          sourceVal = od.Source || od.source || sourceVal;
        }
      } catch (e) {
        console.warn(`createSpedizioniEntries: failed to read Source from order ${pr.orderRef}: ${e.message}`);
      }
    }

    batch.set(ref, {
      orderId: pr.bda || null,
      orderReference: orderReference,
      parcelId: pr.parcelId,
      destinationName: pr.destinationName || null,
      contractIndex: pr.contractIndex || 0,
      Corriere: "GLS",
      Data_String: dataString,
      status: "created",
      warehouseStatus: "In Preparazione",
      createdAt: Timestamp.now(),
      Source: sourceVal,
      raw: pr,
    });
  }

  await batch.commit();
}

// Update status on existing Spedizioni docs
async function updateSpedizioniStatus(resultsArray, newStatus) {
  const firestore = adminDb();
  const batch = firestore.batch();
  const ts = Timestamp.now();

  resultsArray.forEach((r) => {
    const ref = firestore.collection("Spedizioni").doc(r.parcelId);
    batch.update(ref, {
      status: newStatus,
      updatedAt: ts,
      closeInfo: r,
    });
  });

  await batch.commit();
}

// Get ZPL label by shipment number or BDA
async function getZplBySped(auth, numeroSpedizione, bda = null, numeroCollo = 1, tipoPorto = "F") {
  validateAuth(auth);

  if (!numeroSpedizione && !bda) {
    throw new Error("Either numeroSpedizione or bda must be provided");
  }
  if (numeroSpedizione && bda) {
    throw new Error("Provide either numeroSpedizione OR bda, not both");
  }

  console.log(`Getting ZPL label for ${numeroSpedizione ? "domestic" : "international"} shipment: ${numeroSpedizione || bda}`);

  // Determine SedeGls based on branch ID
  let sedeGls;
  if (auth.branchId === process.env.GLS_BRANCH_ID) {
    sedeGls = "NI"; // Contract 0
  } else if (auth.branchId === process.env.GLS2_BRANCH_ID) {
    sedeGls = "R2"; // Contract 1
  } else {
    sedeGls = auth.branchId;
  }

  console.log(`Using SedeGls: ${sedeGls} for branch: ${auth.branchId}`);

  const requestData = {
    SedeGls: sedeGls,
    CodiceCliente: auth.clientId,
    Password: auth.password,
    CodiceContratto: auth.contractId,
    NumeroSpedizione: numeroSpedizione || "",
    Bda: bda || "0",
    NumeroCollo: numeroCollo.toString(),
    TipoPorto: tipoPorto,
  };

  try {
    const response = await makeGlsRequest("GetZplBySped", requestData);
    const parsedResponse = await parseXmlResponse(response);

    if (!parsedResponse || !parsedResponse.Zpl) {
      throw new Error("Invalid response from GLS API");
    }
    const zplString = parsedResponse.Zpl;
    if (!zplString) {
      throw new Error("No ZPL data received from GLS API");
    }

    console.log(`Successfully retrieved ZPL label for shipment: ${numeroSpedizione || bda}`);
    return { zplString, numeroSpedizione, bda, numeroCollo, success: true };
  } catch (error) {
    console.error(`Error getting ZPL label: ${error.message}`);
    throw error;
  }
}

// Upload ZPL data to Cloud Storage
async function uploadZplToStorage(zplData, fileName) {
  const storage = adminStorage();
  try {
    const bucket = storage.bucket(BUCKET);
    const file = bucket.file(fileName);
    await file.save(zplData, {
      metadata: { contentType: "text/plain", cacheControl: "public, max-age=31536000" },
    });
    await file.makePublic();
    console.log(`ZPL file uploaded successfully: ${fileName}`);
    return `https://storage.googleapis.com/${BUCKET}/${fileName}`;
  } catch (error) {
    console.error("Error uploading ZPL to storage:", error);
    throw new Error(`Failed to upload ZPL file: ${error.message}`);
  }
}

// Process ZPL request for an order
async function processOrderZpl(ordiniId) {
  const firestore = adminDb();
  try {
    console.log(`Processing ZPL request for order: ${ordiniId}`);
    const orderDoc = await firestore.collection("Ordini").doc(ordiniId).get();
    if (!orderDoc.exists) {
      throw new Error(`Order ${ordiniId} not found`);
    }
    const orderData = orderDoc.data();

    if (orderData.GLS_ContractIndex === undefined) {
      throw new Error(`Order ${ordiniId} is missing GLS_ContractIndex field`);
    }
    if (orderData.GLS_IsInternational === undefined) {
      throw new Error(`Order ${ordiniId} is missing GLS_IsInternational field`);
    }
    if (!orderData.GLS_TotalPackages) {
      throw new Error(`Order ${ordiniId} is missing GLS_TotalPackages field`);
    }
    if (!orderData.GLS_Tracking || !Array.isArray(orderData.GLS_Tracking) || orderData.GLS_Tracking.length === 0) {
      throw new Error(`Order ${ordiniId} is missing GLS_Tracking data. Shipments must be created before generating ZPL labels.`);
    }

    const contractIndex = orderData.GLS_ContractIndex;
    const auth = getAuthByContract(contractIndex);
    const isInternational = orderData.GLS_IsInternational;
    const totalPackages = orderData.GLS_TotalPackages;

    console.log(`Order details: ContractIndex=${contractIndex}, IsInternational=${isInternational}, TotalPackages=${totalPackages}`);

    const trackingInfo = orderData.GLS_Tracking[0];
    if (!trackingInfo || !trackingInfo.allParcelIds || !Array.isArray(trackingInfo.allParcelIds)) {
      throw new Error(`Order ${ordiniId} is missing allParcelIds in GLS_Tracking. Cannot generate ZPL without actual shipment numbers.`);
    }

    const actualParcelIds = trackingInfo.allParcelIds;
    if (actualParcelIds.length !== totalPackages) {
      console.warn(`Warning: TotalPackages (${totalPackages}) doesn't match actual parcel count (${actualParcelIds.length}). Using actual parcel count.`);
    }

    const zplResults = [];
    const zplUrls = [];

    for (let packageIndex = 0; packageIndex < actualParcelIds.length; packageIndex++) {
      const actualParcelId = actualParcelIds[packageIndex];
      const numeroCollo = packageIndex + 1;

      let finalNumeroSpedizione = actualParcelId;
      let finalBda = null;

      if (!isInternational) {
        if (contractIndex === 0) {
          finalNumeroSpedizione = actualParcelId.replace(/^NI/, "");
        } else if (contractIndex === 1) {
          finalNumeroSpedizione = actualParcelId.replace(/^R2/, "");
        }
        console.log(`Domestic shipment: Using NumeroSpedizione ${finalNumeroSpedizione} (from stored ${actualParcelId})`);
      } else {
        console.log(`International shipment: Using NumeroSpedizione ${finalNumeroSpedizione} directly`);
      }

      const zplResult = await getZplBySped(auth, finalNumeroSpedizione, finalBda, numeroCollo);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `ZPL_Labels/${ordiniId}_${actualParcelId}_package_${numeroCollo}_${timestamp}.zpl`;
      const publicUrl = await uploadZplToStorage(zplResult.zplString, fileName);

      zplResults.push({ numeroCollo, shipmentNumber: actualParcelId, zplUrl: publicUrl, fileName });
      zplUrls.push(publicUrl);
      console.log(`Successfully processed ZPL for package ${numeroCollo} (${actualParcelId}): ${publicUrl}`);
    }

    const updateData = {
      ZPL_Labels: zplUrls,
      ZPL_GeneratedAt: new Date().toISOString(),
      ZPL_ShipmentIds: actualParcelIds,
      ZPL_IsInternational: isInternational,
      ZPL_ContractIndex: contractIndex,
      ZPL_TotalPackages: actualParcelIds.length,
      ZPL_Details: zplResults,
      Corriere: "GLS",
    };

    await firestore.collection("Ordini").doc(ordiniId).update(updateData);
    console.log(`Successfully processed ZPL for order ${ordiniId} - ${actualParcelIds.length} packages`);

    return {
      orderId: ordiniId,
      zplUrls,
      shipmentIds: actualParcelIds,
      isInternational,
      contractIndex,
      totalPackages: actualParcelIds.length,
      zplDetails: zplResults,
      success: true,
    };
  } catch (error) {
    console.error(`Error processing ZPL for order ${ordiniId}: ${error.message}`);
    throw error;
  }
}

// Delete all parcels for multiple orders
async function deleteMultipleOrders(ordiniIds) {
  const firestore = adminDb();
  if (!Array.isArray(ordiniIds) || ordiniIds.length === 0) {
    throw new Error("Array of Ordini IDs is required and must not be empty");
  }

  const contractIndex = await getContractIndexFromOrders(ordiniIds);
  const auth = getAuthByContract(contractIndex);
  validateAuth(auth);

  console.log(`Processing ${ordiniIds.length} orders for deletion using contract ${contractIndex}`);

  const results = [];
  const allParcelIds = [];

  for (const ordiniId of ordiniIds) {
    try {
      const orderDoc = await firestore.collection("Ordini").doc(ordiniId).get();
      if (!orderDoc.exists) {
        results.push({ orderId: ordiniId, status: "failed", error: `Order ${ordiniId} not found` });
        continue;
      }
      const orderData = orderDoc.data();
      const trackingInfo = orderData.GLS_Tracking || [];
      const orderParcelIds = [];

      trackingInfo.forEach((tracking) => {
        if (tracking.parcelId && tracking.status === "created") {
          if (tracking.allParcelIds && Array.isArray(tracking.allParcelIds)) {
            orderParcelIds.push(...tracking.allParcelIds);
          } else {
            orderParcelIds.push(tracking.parcelId);
          }
        }
      });

      if (orderParcelIds.length === 0) {
        results.push({ orderId: ordiniId, status: "failed", error: "No parcels found to delete for this order" });
        continue;
      }

      allParcelIds.push(...orderParcelIds);
      results.push({ orderId: ordiniId, parcelIds: orderParcelIds, parcelsCount: orderParcelIds.length, status: "pending" });
    } catch (error) {
      results.push({ orderId: ordiniId, status: "failed", error: error.message });
    }
  }

  if (allParcelIds.length === 0) {
    throw new Error("No parcels found to delete in any of the provided orders");
  }

  const deleteResults = [];
  for (const parcelId of allParcelIds) {
    try {
      await deleteParcel(auth, parcelId);
      deleteResults.push({ parcelId, success: true });
      console.log(`Successfully deleted parcel: ${parcelId}`);
    } catch (error) {
      deleteResults.push({ parcelId, success: false, error: error.message });
      console.error(`Failed to delete parcel ${parcelId}: ${error.message}`);
    }
  }

  for (const result of results) {
    if (result.status === "pending") {
      try {
        const orderDeleteResults = deleteResults.filter((dr) => result.parcelIds.includes(dr.parcelId));
        const successCount = orderDeleteResults.filter((dr) => dr.success).length;
        const failCount = orderDeleteResults.filter((dr) => !dr.success).length;

        const updateData = {
          GLS_DeletedAt: new Date().toISOString(),
          GLS_DeleteResults: orderDeleteResults,
        };
        updateData.GLS_Status = successCount > 0 ? "parcels_deleted" : "delete_failed";

        await firestore.collection("Ordini").doc(result.orderId).update(updateData);

        result.status = "completed";
        result.parcelsDeleted = successCount;
        result.parcelsFailed = failCount;
        result.deleteResults = orderDeleteResults;
      } catch (error) {
        result.status = "failed";
        result.error = `Failed to update order: ${error.message}`;
      }
    }
  }

  const totalDeleted = deleteResults.filter((r) => r.success).length;
  const totalFailed = deleteResults.filter((r) => !r.success).length;

  return {
    ordersProcessed: ordiniIds.length,
    totalParcelsDeleted: totalDeleted,
    totalParcelsFailed: totalFailed,
    orderResults: results,
    allDeleteResults: deleteResults,
    contractIndex,
  };
}

// Helper: country name → ISO code
function getCountryCode(countryName) {
  const countryMapping = {
    France: "FR", Francia: "FR", "République française": "FR", Frankreich: "FR",
    Germany: "DE", Germania: "DE", Deutschland: "DE", Allemagne: "FR",
    Spain: "ES", Spagna: "ES", "España": "ES", Spanien: "ES", Espagne: "ES",
    "United Kingdom": "GB", "Regno Unito": "GB", UK: "GB", "Great Britain": "GB", "Gran Bretagna": "GB",
    England: "GB", Inghilterra: "GB", Scotland: "GB", Scozia: "GB", Wales: "GB", Galles: "GB",
    Netherlands: "NL", "Paesi Bassi": "NL", Nederland: "NL", Holland: "NL", Olanda: "NL", "Pays-Bas": "NL",
    Belgium: "BE", Belgio: "BE", "België": "BE", Belgique: "BE", Belgien: "BE",
    Austria: "AT", "Österreich": "AT", Autriche: "AT",
    Switzerland: "CH", Svizzera: "CH", Schweiz: "CH", Suisse: "CH", Suiza: "CH",
    Portugal: "PT", Portogallo: "PT",
    Poland: "PL", Polonia: "PL", Polska: "PL", Pologne: "PL", Polen: "PL",
    "Czech Republic": "CZ", "Repubblica Ceca": "CZ", "Česká republika": "CZ", Czechia: "CZ", "République tchèque": "CZ", Tschechien: "CZ",
    Hungary: "HU", Ungheria: "HU", "Magyarország": "HU", Hongrie: "HU", Ungarn: "HU",
    Croatia: "HR", Croazia: "HR", Hrvatska: "HR", Croatie: "HR", Kroatien: "HR",
    Slovenia: "SI", Slovenija: "SI", "Slovénie": "SI", Slowenien: "SI",
    Slovakia: "SK", Slovacchia: "SK", Slovensko: "SK", Slovaquie: "SK", Slowakei: "SK",
    Romania: "RO", "România": "RO", Roumanie: "RO", "Rumänien": "RO",
    Bulgaria: "BG", "България": "BG", Bulgarie: "BG", Bulgarien: "BG",
    Greece: "GR", Grecia: "GR", "Ελλάδα": "GR", "Grèce": "GR", Griechenland: "GR",
    Denmark: "DK", Danimarca: "DK", Danmark: "DK", Danemark: "DK", "Dänemark": "DK",
    Sweden: "SE", Svezia: "SE", Sverige: "SE", "Suède": "SE", Schweden: "SE",
    Norway: "NO", Norvegia: "NO", Norge: "NO", "Norvège": "NO", Norwegen: "NO",
    Finland: "FI", Finlandia: "FI", Suomi: "FI", Finlande: "FI", Finnland: "FI",
    Luxembourg: "LU", Lussemburgo: "LU", "Lëtzebuerg": "LU", Luxemburg: "LU",
    Ireland: "IE", Irlanda: "IE", "Éire": "IE", Irlande: "IE", Irland: "IE",
    Italia: "IT", Italy: "IT", Italie: "IT", Italien: "IT",
    Estonia: "EE", Eesti: "EE", Estonie: "EE", Estland: "EE",
    Latvia: "LV", Lettonia: "LV", Latvija: "LV", Lettonie: "LV", Lettland: "LV",
    Lithuania: "LT", Lituania: "LT", Lietuva: "LT", Lituanie: "LT", Litauen: "LT",
    Malta: "MT", Malte: "MT",
    Cyprus: "CY", Cipro: "CY", "Κύπρος": "CY", Chypre: "CY", Zypern: "CY",
    Iceland: "IS", Islanda: "IS", "Ísland": "IS", Islande: "IS", Island: "IS",
    Liechtenstein: "LI",
    Monaco: "MC",
    "San Marino": "SM",
    Vatican: "VA", "Vatican City": "VA", Vaticano: "VA", "Cité du Vatican": "VA", Vatikanstadt: "VA",
    Andorra: "AD",
    Serbia: "RS", "Србија": "RS", Serbie: "RS", Serbien: "RS",
    Montenegro: "ME", "Crna Gora": "ME", "Monténégro": "ME",
    "Bosnia and Herzegovina": "BA", "Bosnia ed Erzegovina": "BA", "Bosna i Hercegovina": "BA", "Bosnie-Herzégovine": "BA", "Bosnien und Herzegowina": "BA",
    "North Macedonia": "MK", "Macedonia del Nord": "MK", "Северна Македонија": "MK", "Macédoine du Nord": "MK", Nordmazedonien: "MK",
    Albania: "AL", "Shqipëria": "AL", Albanie: "AL", Albanien: "AL",
    Moldova: "MD", "République de Moldova": "MD", Moldau: "MD",
    Ukraine: "UA", Ucraina: "UA", "Україна": "UA",
    Belarus: "BY", Bielorussia: "BY", "Беларусь": "BY", "Biélorussie": "BY", "Weißrussland": "BY",
    Russia: "RU", "Russian Federation": "RU", "Federazione Russa": "RU", "Россия": "RU", Russie: "RU", Russland: "RU",
  };
  return countryMapping[countryName] || null;
}

// Helper: Italian ZIP code → province code
function getProvinceFromZip(zipCode) {
  if (!zipCode) return "";
  const numericZip = zipCode.replace(/\D/g, "");
  const zipPrefix = parseInt(numericZip.substring(0, 3));

  const zipToProvinceMap = {
    20: "MI", 21: "VA", 22: "CO", 23: "SO", 24: "BG", 25: "BS", 26: "CR", 27: "PV", 28: "NO",
    10: "TO", 11: "AO", 12: "CN", 13: "VC", 14: "AT", 15: "AL",
    16: "GE", 17: "SP", 18: "IM", 19: "SV",
    30: "VE", 31: "TV", 32: "BL", 33: "UD", 34: "TS", 35: "PD", 36: "VI", 37: "VR", 38: "TN", 39: "BZ",
    40: "BO", 41: "MO", 42: "RE", 43: "PR", 44: "FE", 45: "FE", 46: "MN", 47: "FC", 48: "RA", 29: "PC",
    50: "FI", 51: "PT", 52: "AR", 53: "SI", 54: "MS", 55: "LU", 56: "PI", 57: "LI", 58: "GR", 59: "PO",
    60: "AN", 61: "PU", 62: "MC", 63: "AP",
    "05": "TR", "06": "PG",
    "00": "RM", "01": "VT", "02": "RI", "03": "FR", "04": "LT",
    64: "TE", 65: "PE", 66: "CH", 67: "AQ",
    86: "CB", 87: "IS",
    80: "NA", 81: "CE", 82: "BN", 83: "AV", 84: "SA",
    70: "BA", 71: "FG", 72: "BR", 73: "LE", 74: "TA", 75: "MT", 76: "BT",
    85: "PZ",
    88: "CZ", 89: "RC",
    90: "PA", 91: "TP", 92: "AG", 93: "CL", 94: "EN", 95: "CT", 96: "SR", 97: "RG", 98: "ME",
    "07": "SS", "08": "CA", "09": "CA",
  };

  if (zipToProvinceMap[zipPrefix]) return zipToProvinceMap[zipPrefix];

  const zipPrefix2 = parseInt(numericZip.substring(0, 2));
  if (zipToProvinceMap[zipPrefix2]) return zipToProvinceMap[zipPrefix2];

  const zipPrefixString = numericZip.substring(0, 2);
  if (zipToProvinceMap[zipPrefixString]) return zipToProvinceMap[zipPrefixString];

  console.warn(`Unknown ZIP code prefix: ${zipPrefix} (from ${zipCode})`);
  return "";
}

// Process multiple orders with contract support + automatic ZPL generation
/**
 * @param {{ branchId: string, clientId: string, password: string, contractId: string }} auth
 * @param {string[]} ordiniIds
 * @param {number} [contractIndex]
 * @param {boolean} [generateZpl]
 * @param {(progress: { processedCount: number, successCount: number, failedCount: number, total: number, failures: Array<{ orderId: string, error: string }>, lastOrderId: string }) => Promise<void> | void} [onProgress]
 */
async function processMultipleOrders(auth, ordiniIds, contractIndex = 0, generateZpl = true, onProgress = null) {
  validateAuth(auth);
  if (!Array.isArray(ordiniIds) || ordiniIds.length === 0) {
    throw new Error("Array of Ordini IDs is required and must not be empty");
  }

  console.log(`Processing ${ordiniIds.length} orders for parcel creation using contract ${contractIndex}`);

  const results = [];
  const summary = {
    ordersProcessed: 0, ordersSuccessful: 0, ordersFailed: 0,
    totalPackagesCreated: 0, totalWeightCreated: 0,
    contractIndex, zplGenerated: 0, zplFailed: 0, errors: [],
  };

  for (const ordiniId of ordiniIds) {
    let orderResult = null;
    let zplResult = null;
    try {
      orderResult = await processOrderParcels(auth, ordiniId, contractIndex);

      if (generateZpl) {
        try {
          zplResult = await processOrderZpl(ordiniId);
          summary.zplGenerated++;
        } catch (zplError) {
          console.error(`Failed to generate ZPL for order ${ordiniId}:`, zplError.message);
          summary.zplFailed++;
          zplResult = { success: false, error: zplError.message };
        }
      }

      results.push({
        orderId: ordiniId,
        status: "success",
        contractIndex,
        zplGenerated: generateZpl ? zplResult && zplResult.success : false,
        zplError: zplResult && !zplResult.success ? zplResult.error : null,
        zplDetails: zplResult && zplResult.success ? zplResult : null,
        ...orderResult,
      });

      summary.ordersSuccessful++;
      summary.totalPackagesCreated += orderResult.totalPackages;
      summary.totalWeightCreated += orderResult.totalWeight;
    } catch (error) {
      console.error(`Failed to process order ${ordiniId}:`, error.message);
      results.push({ orderId: ordiniId, status: "failed", error: error.message, contractIndex, zplGenerated: false });
      summary.ordersFailed++;
      summary.errors.push({ orderId: ordiniId, error: error.message });
    }
    summary.ordersProcessed++;

    if (onProgress) {
      try {
        await onProgress({
          processedCount: summary.ordersProcessed,
          successCount: summary.ordersSuccessful,
          failedCount: summary.ordersFailed,
          total: ordiniIds.length,
          failures: summary.errors,
          lastOrderId: ordiniId,
        });
      } catch (progressError) {
        console.error("onProgress callback failed:", progressError.message);
      }
    }
  }

  console.log(`Batch processing completed: ${summary.ordersSuccessful} successful, ${summary.ordersFailed} failed`);
  return { summary, results };
}

// Process a single order's parcels (Colli/Peso or Articoli based)
async function processOrderParcels(auth, ordiniId, contractIndex = 0) {
  const firestore = adminDb();
  validateAuth(auth);

  console.log(`Processing order: ${ordiniId} using contract ${contractIndex}`);

  const orderDoc = await firestore.collection("Ordini").doc(ordiniId).get();
  if (!orderDoc.exists) {
    throw new Error(`Order ${ordiniId} not found`);
  }
  const orderData = orderDoc.data();

  // Cash on delivery
  let paymentAmount = null;
  let paymentMethod = null;
  if (orderData.Pagamento && (orderData.Pagamento.Nome === "Pagamento alla consegna" || orderData.Pagamento.Nome === "Contrassegno")) {
    paymentAmount = orderData.Totale ? orderData.Totale.toString().replace(".", ",") : null;
    paymentMethod = "CONT";
    console.log(`Cash on Delivery detected: Amount = ${paymentAmount}, Method = ${paymentMethod}`);
  }

  // BDA = order.ID field
  const ordiniIdForBda = orderData.ID;
  if (!ordiniIdForBda) {
    throw new Error(`Order ${ordiniId} is missing the ID field required for BDA`);
  }

  const shippingAddress = orderData.Indirizzo_Spedizione;
  if (!shippingAddress) {
    throw new Error("Shipping address not found in order");
  }

  const country = shippingAddress.Paese || "Italia";
  const italyVariations = ["Italia", "Italy", "ITALIA", "ITALY", "it", "IT", "ita", "ITA"];
  const isItaly =
    orderData.IsItaly ||
    italyVariations.includes(country) ||
    italyVariations.some((variation) => country.toLowerCase().includes(variation.toLowerCase()));
  const isInternational = !isItaly;
  console.log(`Shipping destination: ${country}, IsItaly: ${isItaly}, IsInternational: ${isInternational}`);

  // Province (Italian only)
  let province = "";
  if (isItaly) {
    if (shippingAddress.Citta) {
      const provinceMatch = shippingAddress.Citta.match(/\(([A-Z]{2})\)/);
      province = provinceMatch ? provinceMatch[1] : "";
      const cityName = shippingAddress.Citta.replace(/\s*\([A-Z]{2}\)/, "").trim();
      shippingAddress.CityClean = cityName;
    }
    if (!province && shippingAddress.CAP) {
      province = getProvinceFromZip(shippingAddress.CAP);
    }
    if (!province && shippingAddress.Provincia) {
      province = shippingAddress.Provincia;
    }
    console.log(`Final province for Italian shipment: ${province}`);
  }

  const hasColliAndPeso = orderData.Colli && orderData.Peso;
  let totalPackages, totalWeight, parcels, articleDetails;

  if (hasColliAndPeso) {
    totalPackages = parseInt(orderData.Colli) || 1;
    totalWeight = parseFloat(orderData.Peso.toString().replace(",", ".")) || 5.0;
    console.log(`Using order-specific values: Colli=${totalPackages}, Peso=${totalWeight}kg`);

    articleDetails = [];
    for (const articolo of orderData.Articoli || []) {
      articleDetails.push({ sku: articolo.SKU, title: articolo.Titolo, quantity: articolo.Quantita || 1, weight: totalWeight });
    }

    parcels = [];
    const weightPerPackage = (totalWeight / totalPackages).toFixed(1).replace(".", ",");
    const firstArticle = orderData.Articoli && orderData.Articoli.length > 0 ? orderData.Articoli[0] : null;

    for (let i = 0; i < totalPackages; i++) {
      const parcel = {
        name: shippingAddress.Destinatario,
        address: shippingAddress.Via,
        city: isItaly ? shippingAddress.CityClean || shippingAddress.Citta : shippingAddress.Citta,
        postcode: shippingAddress.CAP,
        province: isItaly ? province : "",
        weight: weightPerPackage,
        email: orderData.Email || "",
        orderId: ordiniIdForBda,
        customerReference: `${ordiniId}_package_${i + 1}`,
        noteOnLabel: firstArticle && firstArticle.Titolo ? firstArticle.Titolo : `Package ${i + 1} of ${totalPackages}`,
        primaryMobilePhoneNumber: shippingAddress.Telefono ? shippingAddress.Telefono.replace(/[^0-9]/g, "").slice(-10) : "",
        shipmentType: isItaly ? "N" : "P",
        packageType: 0,
        numOfPackages: 1,
        ...(paymentAmount && i === 0 && { paymentAmount }),
        ...(paymentMethod && i === 0 && { paymentMethod }),
        countryCode: isItaly ? null : /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : getCountryCode(country),
      };

      if (isInternational) {
        parcel.referencePersonName = firstArticle && firstArticle.Titolo ? firstArticle.Titolo : shippingAddress.Destinatario;
        parcel.referencePersonPhoneNumber = shippingAddress.Telefono;
        if (!parcel.countryCode) {
          throw new Error(`Unsupported country: ${country}`);
        }
      }

      validateParcel(parcel, isItaly);
      parcels.push(parcel);
    }
  } else {
    console.log("Using default method: calculating packages based on articles");
    parcels = [];
    let packageCounter = 1;
    articleDetails = [];
    let isFirstParcel = true;

    for (const articolo of orderData.Articoli || []) {
      const quantity = articolo.Quantita || 1;
      articleDetails.push({ sku: articolo.SKU, title: articolo.Titolo, quantity, weight: quantity * 5 });

      for (let i = 0; i < quantity; i++) {
        const parcel = {
          name: shippingAddress.Destinatario,
          address: shippingAddress.Via,
          city: isItaly ? shippingAddress.CityClean || shippingAddress.Citta : shippingAddress.Citta,
          postcode: shippingAddress.CAP,
          province: isItaly ? province : "",
          weight: "5,0",
          email: orderData.Email || "",
          orderId: ordiniIdForBda,
          customerReference: `${ordiniId}_${articolo.SKU}_${packageCounter}`,
          noteOnLabel: `${articolo.Titolo}`,
          primaryMobilePhoneNumber: shippingAddress.Telefono ? shippingAddress.Telefono.replace(/[^0-9]/g, "").slice(-10) : "",
          shipmentType: isItaly ? "N" : "P",
          packageType: 0,
          numOfPackages: 1,
          ...(paymentAmount && isFirstParcel && { paymentAmount }),
          ...(paymentMethod && isFirstParcel && { paymentMethod }),
          countryCode: isItaly ? null : /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : getCountryCode(country),
        };
        isFirstParcel = false;

        if (isInternational) {
          parcel.referencePersonName = articolo.Titolo || shippingAddress.Destinatario;
          parcel.referencePersonPhoneNumber = shippingAddress.Telefono;
          if (!parcel.countryCode) {
            throw new Error(`Unsupported country: ${country}`);
          }
        }

        validateParcel(parcel, isItaly);
        parcels.push(parcel);
        packageCounter++;
      }
    }

    totalPackages = parcels.length;
    totalWeight = totalPackages * 5;
  }

  console.log(`Created ${totalPackages} individual parcels for ${isInternational ? "international" : "domestic"} shipment (Method: ${hasColliAndPeso ? "Colli/Peso" : "Articles"})`);

  const glsResult = await addParcels(auth, parcels);

  const pdfLabels = [];
  const trackingNumbers = [];
  for (let i = 0; i < glsResult.length; i++) {
    const result = glsResult[i];
    if (!result.error && result.parcelId && result.pdfLabel) {
      pdfLabels.push(result.pdfLabel);
      trackingNumbers.push(result.parcelId);
    } else {
      console.error(`Failed to create package ${i + 1}: ${result.error}`);
      throw new Error(`Failed to create package ${i + 1}: ${result.error}`);
    }
  }

  if (pdfLabels.length === 0) {
    throw new Error("No PDF labels were generated");
  }

  const mainTrackingNumber = trackingNumbers[0];
  const combinedPdfBase64 = await combinePdfs(pdfLabels);
  const fileName = `Label_Ordini/${ordiniId}_${mainTrackingNumber}_all_labels.pdf`;
  await uploadPdfToStorage(combinedPdfBase64, fileName);
  const publicUrl = `https://storage.googleapis.com/${BUCKET}/${fileName}`;

  const trackingInfo = {
    parcelId: mainTrackingNumber,
    totalPackages,
    totalWeight: hasColliAndPeso ? totalWeight.toString().replace(".", ",") : `${totalWeight},0`,
    articles: articleDetails,
    allParcelIds: trackingNumbers,
    pdfPages: pdfLabels.length,
    status: "created",
    createdAt: new Date().toISOString(),
    isInternational,
    shipmentType: isInternational ? "P" : "N",
    contractIndex,
    ordiniIdForBda,
    calculationMethod: hasColliAndPeso ? "colli_peso" : "articles",
  };

  // ALWAYS format tracking number as BranchID + tracking number
  const finalTrackingNumber = `${auth.branchId}${mainTrackingNumber}`;
  console.log(`Final tracking number with BranchID: ${finalTrackingNumber} (${isInternational ? "international" : "domestic"})`);

  await firestore.collection("Ordini").doc(ordiniId).update({
    GLS_Tracking: [trackingInfo],
    GLS_TrackingNumber: finalTrackingNumber,
    GLS_PdfUrl: publicUrl,
    GLS_ProcessedAt: new Date().toISOString(),
    GLS_Status: "shipment_created",
    GLS_TotalPackages: totalPackages,
    GLS_TotalWeight: totalWeight,
    GLS_Articles: articleDetails,
    GLS_IsInternational: isInternational,
    GLS_ContractIndex: contractIndex,
    GLS_BdaUsed: ordiniIdForBda,
    GLS_CalculationMethod: hasColliAndPeso ? "colli_peso" : "articles",
  });

  return {
    orderId: ordiniId,
    ordiniIdForBda,
    destinationName: shippingAddress.Destinatario,
    shipmentsCreated: 1,
    totalPackages,
    totalWeight,
    trackingNumber: finalTrackingNumber,
    pdfUrl: publicUrl,
    trackingInfo,
    allParcelIds: trackingNumbers,
    isInternational,
    contractIndex,
    calculationMethod: hasColliAndPeso ? "colli_peso" : "articles",
  };
}

// Combine multiple base64 PDFs into one multi-page PDF
async function combinePdfs(pdfBase64Array) {
  try {
    if (pdfBase64Array.length === 1) return pdfBase64Array[0];

    const mergedPdf = await PDFDocument.create();
    for (let i = 0; i < pdfBase64Array.length; i++) {
      try {
        const pdfBytes = Uint8Array.from(Buffer.from(pdfBase64Array[i], "base64"));
        const pdf = await PDFDocument.load(pdfBytes);
        const pageIndices = pdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } catch (error) {
        console.error(`Error processing PDF label ${i + 1}:`, error);
      }
    }
    const mergedPdfBytes = await mergedPdf.save();
    return Buffer.from(mergedPdfBytes).toString("base64");
  } catch (error) {
    console.error("Error combining PDFs:", error);
    return pdfBase64Array[0];
  }
}

// Upload PDF to Cloud Storage (public)
async function uploadPdfToStorage(base64PdfData, fileName) {
  const storage = adminStorage();
  try {
    const bucket = storage.bucket(BUCKET);
    const file = bucket.file(fileName);
    const pdfBuffer = Buffer.from(base64PdfData, "base64");
    await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" }, public: true });
    console.log(`Uploaded PDF: ${fileName}`);
    return `https://storage.googleapis.com/${BUCKET}/${fileName}`;
  } catch (error) {
    console.error(`Failed to upload PDF ${fileName}:`, error);
    throw error;
  }
}

// Close one order's parcels (auto contract index)
async function closeOrderParcels(ordiniId) {
  const firestore = adminDb();
  const contractIndex = await getContractIndexFromOrder(ordiniId);
  const auth = getAuthByContract(contractIndex);
  validateAuth(auth);

  const orderDoc = await firestore.collection("Ordini").doc(ordiniId).get();
  if (!orderDoc.exists) {
    throw new Error(`Order ${ordiniId} not found`);
  }
  const orderData = orderDoc.data();
  const trackingInfo = orderData.GLS_Tracking || [];

  const parcelIds = [];
  trackingInfo.forEach((tracking) => {
    if (tracking.parcelId && tracking.status === "created") {
      if (tracking.allParcelIds && Array.isArray(tracking.allParcelIds)) {
        parcelIds.push(...tracking.allParcelIds);
      } else {
        parcelIds.push(tracking.parcelId);
      }
    }
  });

  if (parcelIds.length === 0) {
    throw new Error("No parcels found to close for this order");
  }

  const closeResult = await closeParcelsByShipmentNumber(auth, parcelIds);
  const successCount = closeResult.filter((r) => r.success).length;
  const failCount = closeResult.filter((r) => !r.success).length;

  const updateData = { GLS_ClosedAt: new Date().toISOString(), GLS_CloseResults: closeResult };
  if (successCount > 0) {
    updateData.GLS_Status = "parcels_closed";
    updateData.Stato = "Spedito";
  } else {
    updateData.GLS_Status = "close_failed";
  }

  await firestore.collection("Ordini").doc(ordiniId).update(updateData);

  return {
    orderId: ordiniId,
    parcelsClosed: successCount,
    parcelsFailed: failCount,
    statoUpdated: successCount > 0 ? "Spedito" : "unchanged",
    results: closeResult,
    contractIndex,
  };
}

// Close multiple orders, grouping by per-order contract index
async function closeMultipleOrders(ordiniIds) {
  const firestore = adminDb();
  if (!Array.isArray(ordiniIds) || ordiniIds.length === 0) {
    throw new Error("Array of Ordini IDs is required and must not be empty");
  }

  const ordersByContract = {};
  const orderContractMapping = {};
  const initialResults = [];

  for (const ordiniId of ordiniIds) {
    try {
      const contractIndex = await getContractIndexFromOrder(ordiniId);
      orderContractMapping[ordiniId] = contractIndex;
      if (!ordersByContract[contractIndex]) ordersByContract[contractIndex] = [];
      ordersByContract[contractIndex].push(ordiniId);
    } catch (error) {
      initialResults.push({ orderId: ordiniId, status: "failed", error: `Failed to determine contract: ${error.message}`, contractIndex: null });
    }
  }

  const allResults = [...initialResults];
  const allCloseResults = [];
  let totalClosed = 0;
  let totalFailed = 0;

  for (const [contractIndex, orderIds] of Object.entries(ordersByContract)) {
    try {
      const auth = getAuthByContract(parseInt(contractIndex));
      validateAuth(auth);

      for (const ordiniId of orderIds) {
        try {
          const orderDoc = await firestore.collection("Ordini").doc(ordiniId).get();
          if (!orderDoc.exists) {
            allResults.push({ orderId: ordiniId, status: "failed", error: `Order ${ordiniId} not found`, contractIndex: parseInt(contractIndex) });
            continue;
          }
          const orderData = orderDoc.data();
          const trackingInfo = orderData.GLS_Tracking || [];
          const orderParcelIds = [];

          trackingInfo.forEach((tracking) => {
            if (tracking.parcelId && tracking.status === "created") {
              if (tracking.allParcelIds && Array.isArray(tracking.allParcelIds)) {
                orderParcelIds.push(...tracking.allParcelIds);
              } else {
                orderParcelIds.push(tracking.parcelId);
              }
            }
          });

          if (orderParcelIds.length === 0) {
            allResults.push({ orderId: ordiniId, status: "failed", error: "No parcels found to close for this order", contractIndex: parseInt(contractIndex) });
            continue;
          }

          const orderCloseResults = await closeParcelsByShipmentNumber(auth, orderParcelIds);
          allCloseResults.push(...orderCloseResults);

          const successCount = orderCloseResults.filter((cr) => cr.success).length;
          const failCount = orderCloseResults.filter((cr) => !cr.success).length;
          totalClosed += successCount;
          totalFailed += failCount;

          const updateData = { GLS_ClosedAt: new Date().toISOString(), GLS_CloseResults: orderCloseResults };
          if (successCount > 0) {
            updateData.GLS_Status = "parcels_closed";
            updateData.Stato = "Spedito";
          } else {
            updateData.GLS_Status = "close_failed";
          }
          await firestore.collection("Ordini").doc(ordiniId).update(updateData);

          allResults.push({
            orderId: ordiniId,
            parcelIds: orderParcelIds,
            parcelsCount: orderParcelIds.length,
            status: "completed",
            parcelsClosed: successCount,
            parcelsFailed: failCount,
            closeResults: orderCloseResults,
            statoUpdated: successCount > 0 ? "Spedito" : "unchanged",
            contractIndex: parseInt(contractIndex),
          });
        } catch (error) {
          allResults.push({ orderId: ordiniId, status: "failed", error: error.message, contractIndex: parseInt(contractIndex) });
        }
      }
    } catch (error) {
      orderIds.forEach((ordiniId) => {
        allResults.push({ orderId: ordiniId, status: "failed", error: `Contract ${contractIndex} error: ${error.message}`, contractIndex: parseInt(contractIndex) });
      });
    }
  }

  return {
    ordersProcessed: ordiniIds.length,
    totalParcelsClosed: totalClosed,
    totalParcelsFailed: totalFailed,
    orderResults: allResults,
    allCloseResults,
    orderContractMapping,
  };
}

// Escape/normalize strings for GLS XML
function formatStringForXml(str, maxLength = null) {
  if (!str) return "";
  let formatted = String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const accentMap = {
    "À": "A", "Á": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A", "Ă": "A", "Ā": "A", "Ą": "A", "Æ": "A", "Ǽ": "A",
    "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a", "ă": "a", "ā": "a", "ą": "a", "æ": "a", "ǽ": "a",
    "È": "E", "É": "E", "Ê": "E", "Ë": "E", "Ĕ": "E", "Ē": "E", "Ę": "E", "Ė": "E",
    "è": "e", "é": "e", "ê": "e", "ë": "e", "ĕ": "e", "ē": "e", "ę": "e", "ė": "e",
    "Ì": "I", "Í": "I", "Î": "I", "Ï": "I", "İ": "I", "Ĩ": "I", "Ī": "I", "Ĭ": "I", "Į": "I",
    "ì": "i", "í": "i", "î": "i", "ï": "i", "į": "i", "ĩ": "i", "ī": "i", "ĭ": "i", "ı": "i",
    "Ò": "O", "Ó": "O", "Ô": "O", "Õ": "O", "Ö": "O", "Ø": "O", "Ō": "O", "Ŏ": "O", "Ő": "O", "Œ": "O",
    "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o", "ō": "o", "ŏ": "o", "ő": "o", "œ": "o", "ð": "o",
    "Ù": "U", "Ú": "U", "Û": "U", "Ü": "U", "Ũ": "U", "Ū": "U", "Ŭ": "U", "Ů": "U", "Ű": "U", "Ų": "U",
    "ù": "u", "ú": "u", "û": "u", "ü": "u", "ũ": "u", "ū": "u", "ŭ": "u", "ů": "u", "ű": "u", "ų": "u",
  };
  for (const [accented, normal] of Object.entries(accentMap)) {
    formatted = formatted.replace(new RegExp(accented, "g"), normal);
  }

  if (maxLength && formatted.length > maxLength) {
    return formatted.substring(0, maxLength);
  }
  return formatted;
}

// Build XML from object (root <Info>)
function buildXml(obj) {
  const builder = new xml2js.Builder({ rootName: "Info", headless: true, renderOpts: { pretty: false } });
  return builder.buildObject(obj);
}

// Close parcels by shipment number
async function closeParcelsByShipmentNumber(auth, parcelIds) {
  validateAuth(auth);
  if (!Array.isArray(parcelIds) || parcelIds.length === 0) {
    throw new Error("Parcel IDs array is required and must not be empty");
  }

  const xmlData = {
    SedeGls: formatStringForXml(auth.branchId, 2),
    CodiceClienteGls: formatStringForXml(auth.clientId, 6),
    PasswordClienteGls: formatStringForXml(auth.password, 10),
  };

  parcelIds.forEach((parcelId, index) => {
    const keyName = index === 0 ? "Parcel" : `Parcel__${index}`;
    xmlData[keyName] = { NumeroDiSpedizioneGLSDaConfermare: parcelId.toString() };
  });

  const xmlString = buildXml(xmlData);
  const response = await makeGlsRequest("CloseWorkDayByShipmentNumber", { _xmlRequest: xmlString });
  const parsed = await parseXmlResponse(response);

  if (parsed.CloseWorkDayByShipmentNumberResult && parsed.CloseWorkDayByShipmentNumberResult.DescrizioneErrore === "OK") {
    const parcels = parsed.CloseWorkDayByShipmentNumberResult.Parcel;
    const results = Array.isArray(parcels) ? parcels : [parcels];
    return results.map((parcel) => ({
      parcelId: parcel.NumeroDiSpedizioneGLSDaConfermare,
      status: parcel.esito,
      success: parcel.esito === "OK",
    }));
  }

  throw new Error(`CloseWorkDayByShipmentNumber failed: ${parsed.DescrizioneErrore || "Unknown error"}`);
}

// HTTP request to GLS API (form-urlencoded), with 30s timeout
async function makeGlsRequest(action, data) {
  const url = `${GLS_WEB_SERVICE_URL}/${action}`;
  console.log(`Making GLS request to: ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      console.error("GLS API error status:", response.status, text?.slice(0, 300));
      throw new Error(`GLS API request failed: HTTP ${response.status}`);
    }
    return text;
  } catch (error) {
    console.error("GLS API request failed:", error.message);
    throw new Error(`GLS API request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// Validate auth data
function validateAuth(auth) {
  const errors = [];
  if (!auth.branchId) errors.push("Branch ID is required");
  if (!auth.clientId) errors.push("Client ID is required");
  if (!auth.password) errors.push("Password is required");
  if (!auth.contractId) errors.push("Contract ID is required");
  if (errors.length > 0) {
    throw new Error(`Authentication validation failed: ${errors.join(", ")}`);
  }
}

// Validate parcel data
function validateParcel(parcel, isItaly = true) {
  const errors = [];
  if (!parcel.name) errors.push("Name is required");
  if (!parcel.address) errors.push("Address is required");
  if (!parcel.city) errors.push("City is required");
  if (!parcel.postcode) errors.push("Postcode is required");
  if (!parcel.weight) errors.push("Weight is required");
  if (isItaly && !parcel.province) errors.push("Province is required for Italian shipments");
  if (errors.length > 0) {
    throw new Error(`Parcel validation failed: ${errors.join(", ")}`);
  }
}

// Convert parcel object → GLS XML format
function convertParcelToGlsFormat(auth, parcel) {
  const glsParcel = {
    CodiceContrattoGls: formatStringForXml(auth.contractId.toString(), 6),
    RagioneSociale: formatStringForXml(parcel.name, 35),
    Indirizzo: formatStringForXml(parcel.address, 35),
    Localita: formatStringForXml(parcel.city, 30),
    Zipcode: formatStringForXml(parcel.postcode, 5),
    PesoReale: formatStringForXml(parcel.weight, 6),
    Colli: parcel.numOfPackages || 1,
    TipoCollo: parcel.packageType || 0,
    Provincia:
      parcel.shipmentType === "N"
        ? formatStringForXml(parcel.province, 2)
        : formatStringForXml(parcel.countryCode, 2),
    ...(parcel.orderId && {
      Bda: formatStringForXml(parcel.orderId.toString(), 11),
      ContatoreProgressivo: formatStringForXml(parcel.orderId.toString(), 11),
    }),
    ...(parcel.email && { Email: formatStringForXml(parcel.email, 70) }),
    ...(parcel.primaryMobilePhoneNumber && { Cellulare1: formatStringForXml(parcel.primaryMobilePhoneNumber, 10) }),
    ...(parcel.secondaryMobilePhoneNumber && { Cellulare2: formatStringForXml(parcel.secondaryMobilePhoneNumber, 10) }),
    ...(parcel.noteOnLabel && { NoteSpedizione: formatStringForXml(parcel.noteOnLabel, 40) }),
    ...(parcel.paymentAmount && { ImportoContrassegno: formatStringForXml(parcel.paymentAmount, 10) }),
    ...(parcel.insuranceAmount && { Assicurazione: formatStringForXml(parcel.insuranceAmount, 11) }),
    ...(parcel.volumeWeight && { PesoVolume: formatStringForXml(parcel.volumeWeight, 11) }),
    ...(parcel.customerReference && { RiferimentoCliente: formatStringForXml(parcel.customerReference, 600) }),
    ...(parcel.additionalServices && { ServiziAccessori: formatStringForXml(parcel.additionalServices, 50) }),
    ...(parcel.paymentMethod && { ModalitaIncasso: formatStringForXml(parcel.paymentMethod, 4) }),
    ...(parcel.deliveryDate && { DataPrenotazioneGDO: formatStringForXml(parcel.deliveryDate, 6) }),
    ...(parcel.labelFormat && { FormatoPdf: formatStringForXml(parcel.labelFormat, 2) }),
    ...(parcel.identPin && { IdentPIN: formatStringForXml(parcel.identPin, 12) }),
    ...(parcel.insuranceType && { AssicurazioneIntegrativa: formatStringForXml(parcel.insuranceType, 1) }),
    ...(parcel.pickUpDelivery && { FermoDeposito: formatStringForXml(parcel.pickUpDelivery, 1) }),
    ...(parcel.pickUpPoint && { SiglaSedeFermoDeposito: formatStringForXml(parcel.pickUpPoint, 4) }),
    ...(parcel.shipmentType && { TipoSpedizione: formatStringForXml(parcel.shipmentType, 1) }),
    ...(parcel.referencePersonName && { PersonaRiferimento: formatStringForXml(parcel.referencePersonName, 50) }),
    ...(parcel.referencePersonPhoneNumber && { TelefonoDestinatario: formatStringForXml(parcel.referencePersonPhoneNumber, 16) }),
    GeneraPdf: 4,
  };
  return glsParcel;
}

// Parse XML response from GLS
async function parseXmlResponse(xmlString) {
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
  try {
    return await parser.parseStringPromise(xmlString);
  } catch (error) {
    console.error("XML parsing failed:", error.message);
    throw new Error(`Failed to parse XML response: ${error.message}`);
  }
}

// Parse AddParcel response
function parseAddParcelResponse(response, isInternational = false) {
  const parcels = Array.isArray(response.Parcel) ? response.Parcel : [response.Parcel];
  return parcels.map((parcel) => {
    const result = {
      parcelId: null,
      pdfLabel: parcel.PdfLabel || "",
      zplLabel: parcel.Zpl || "",
      error: null,
      isInternational,
      bda: parcel.Bda || "",
      numeroSpedizione: parcel.NumeroSpedizione || "",
    };

    if (!parcel.NumeroSpedizione) {
      result.error = "Unknown error. The parcel id was not returned.";
    } else if (parcel.NumeroSpedizione === "999999999") {
      result.error = "Please make sure you defined all the parcel parameters correctly.";
    } else {
      result.parcelId = parcel.NumeroSpedizione;
    }

    Object.assign(result, {
      senderName: parcel.DenominazioneMittente || "",
      volumeWeight: parcel.RapportoPesoVolume || "",
      shippingDate: parcel.DataSpedizione || "",
      glsDestination: parcel.DescrizioneSedeDestino || "",
      receiverName: parcel.DenominazioneDestinatario || "",
      address: parcel.IndirizzoDestinatario || "",
      city: parcel.CittaDestinatario || "",
      province: parcel.ProvinciaDestinatario || "",
    });

    return result;
  });
}

// List parcels
async function listParcels(auth, options = {}) {
  validateAuth(auth);
  const authData = {
    SedeGls: formatStringForXml(auth.branchId, 2),
    CodiceClienteGls: formatStringForXml(auth.clientId, 6),
    PasswordClienteGls: formatStringForXml(auth.password, 10),
  };

  let action = "ListSped";
  let requestData = { ...authData };
  if (options.status !== undefined) {
    action = "ListSpedByStato";
    requestData.Stato = options.status;
  } else if (options.dateFrom || options.dateTo) {
    action = "ListSpedPeriod";
    requestData.DataInizio = options.dateFrom || "";
    requestData.DataFine = options.dateTo || "";
  }

  const response = await makeGlsRequest(action, requestData);
  const parsed = await parseXmlResponse(response);
  if (!parsed.ListParcel || !parsed.ListParcel.Parcel) return [];

  const parcels = Array.isArray(parsed.ListParcel.Parcel) ? parsed.ListParcel.Parcel : [parsed.ListParcel.Parcel];
  return parcels.map((parcel) => ({
    parcelId: parcel.NumSpedizione,
    orderId: parseInt(parcel.Ddt) || null,
    name: parcel.DenominazioneDestinatario,
    city: parcel.CittaDestinatario,
    province: parcel.ProvinciaDestinatario,
    address: parcel.IndirizzoDestinatario,
    numOfPackages: parseInt(parcel.TotaleColli) || 1,
    status: parcel.StatoSpedizione === "IN ATTESA DI CHIUSURA." ? "waiting" : "closed",
  }));
}

// Add parcels (creates shipments + PDF labels)
async function addParcels(auth, parcels) {
  validateAuth(auth);
  if (!Array.isArray(parcels) || parcels.length === 0) {
    throw new Error("Parcels array is required and must not be empty");
  }

  const isInternational = parcels[0].shipmentType === "P";
  const isItaly = parcels[0].shipmentType === "N";

  parcels.forEach((parcel, index) => {
    try {
      validateParcel(parcel, isItaly);
    } catch (error) {
      throw new Error(`Parcel ${index + 1}: ${error.message}`);
    }
  });

  const authData = {
    SedeGls: formatStringForXml(auth.branchId, 2),
    CodiceClienteGls: formatStringForXml(auth.clientId, 6),
    PasswordClienteGls: formatStringForXml(auth.password, 10),
  };

  const xmlData = { ...authData };
  if (parcels.length === 1) {
    xmlData["Parcel"] = convertParcelToGlsFormat(auth, parcels[0]);
  } else {
    xmlData["Parcel"] = parcels.map((parcel) => convertParcelToGlsFormat(auth, parcel));
  }

  const xmlString = buildXml(xmlData);
  const response = await makeGlsRequest("AddParcel", { XMLInfoParcel: xmlString });
  const parsed = await parseXmlResponse(response);

  if (parsed.InfoLabel === "" || (typeof parsed.InfoLabel === "object" && Object.keys(parsed.InfoLabel).length === 0)) {
    throw new Error("GLS returned empty response - likely validation error. Check all required fields are provided correctly.");
  }

  if (parsed.InfoLabel && parsed.InfoLabel.Parcel) {
    return parseAddParcelResponse(parsed.InfoLabel, isInternational);
  } else if (parsed.Parcel) {
    return parseAddParcelResponse({ Parcel: parsed.Parcel }, isInternational);
  } else if (parsed.DescrizioneErrore) {
    throw new Error(`GLS API Error: ${parsed.DescrizioneErrore}`);
  } else {
    console.error("Unexpected response structure:", parsed);
    throw new Error("Unexpected response structure from GLS API");
  }
}

// Close parcels (full parcel data)
async function closeParcels(auth, parcels) {
  validateAuth(auth);
  if (!Array.isArray(parcels) || parcels.length === 0) {
    throw new Error("Parcels array is required and must not be empty");
  }

  const xmlData = {
    SedeGls: formatStringForXml(auth.branchId, 2),
    CodiceClienteGls: formatStringForXml(auth.clientId, 6),
    PasswordClienteGls: formatStringForXml(auth.password, 10),
  };

  parcels.forEach((parcel, index) => {
    const parcelData = convertParcelToGlsFormat(auth, parcel);
    const keyName = index === 0 ? "Parcel" : `Parcel__${index}`;
    xmlData[keyName] = parcelData;
  });

  const xmlString = buildXml(xmlData);
  const response = await makeGlsRequest("CloseWorkDay", { XMLCloseInfoParcel: xmlString });
  const parsed = await parseXmlResponse(response);
  return parsed.DescrizioneErrore === "OK";
}

// Delete a single parcel
async function deleteParcel(auth, parcelId) {
  validateAuth(auth);
  if (!parcelId) throw new Error("Parcel ID is required");

  const requestData = {
    SedeGls: formatStringForXml(auth.branchId, 2),
    CodiceClienteGls: formatStringForXml(auth.clientId, 6),
    PasswordClienteGls: formatStringForXml(auth.password, 10),
    NumSpedizione: parcelId,
  };

  const response = await makeGlsRequest("DeleteSped", requestData);
  const parsed = await parseXmlResponse(response);
  if (parsed.DescrizioneErrore && parsed.DescrizioneErrore.includes("non presente")) {
    throw new Error(`Can't find parcel ${parcelId}`);
  }
  return true;
}

// Esportate per l'orchestrazione del job bulk in background (route processMultipleOrders):
// il route handler crea/aggiorna il doc SpedizioniJobs mentre queste girano.
export { getAuthByContract, createSpedizioniEntries, processMultipleOrders };

// ─────────────────────────────────────────────────────────────────────────────
// Entry point — replica del router `action` della Cloud Function.
// Riceve il body JSON, ritorna { statusCode, payload }.
// ─────────────────────────────────────────────────────────────────────────────
export async function processGlsAction(body) {
  const { action, contractIndex = 0, ...params } = body || {};
  if (!action) return { statusCode: 400, payload: { error: "Action is required" } };

  let result;
  let usedContractIndex;
  let auth;

  try {
    switch (action) {
      case "list":
      case "listByStatus":
      case "listByPeriod":
      case "add":
      case "processOrder":
      case "processMultipleOrders": {
        usedContractIndex = contractIndex;
        auth = getAuthByContract(usedContractIndex);

        switch (action) {
          case "list":
            result = await listParcels(auth, params);
            break;

          case "listByStatus":
            if (params.status === undefined) {
              return { statusCode: 400, payload: { error: "Status parameter is required" } };
            }
            result = await listParcels(auth, { status: params.status });
            break;

          case "listByPeriod":
            result = await listParcels(auth, { dateFrom: params.dateFrom, dateTo: params.dateTo });
            break;

          case "add": {
            const addedParcels = await addParcels(auth, params.parcels);
            const parcelResults = addedParcels.map((parcel, index) => ({
              parcelId: parcel.parcelId,
              bda: parcel.bda,
              orderRef: params.orderReference || null,
              destinationName: params.parcels[index]?.name || null,
              contractIndex: usedContractIndex,
            }));
            await createSpedizioniEntries(parcelResults);
            result = addedParcels;
            break;
          }

          case "processOrder": {
            const orderResult = await processOrderParcels(auth, params.ordiniId, usedContractIndex);
            const parcelResults = orderResult.allParcelIds.map((id) => ({
              parcelId: id,
              bda: orderResult.ordiniIdForBda,
              orderRef: params.ordiniId,
              destinationName: orderResult.destinationName || null,
              contractIndex: usedContractIndex,
            }));
            await createSpedizioniEntries(parcelResults);
            result = orderResult;
            break;
          }

          case "processMultipleOrders": {
            const batchResult = await processMultipleOrders(auth, params.ordiniIds, usedContractIndex, true);
            const toCreate = [];
            batchResult.results.forEach((r) => {
              if (r.status === "success") {
                r.allParcelIds.forEach((id) => {
                  toCreate.push({
                    parcelId: id,
                    bda: r.ordiniIdForBda,
                    orderRef: r.orderId,
                    destinationName: r.destinationName || null,
                    contractIndex: usedContractIndex,
                  });
                });
              }
            });
            if (toCreate.length) {
              await createSpedizioniEntries(toCreate);
            }
            result = batchResult;
            break;
          }
        }
        break;
      }

      case "closeByShipmentNumber": {
        usedContractIndex = contractIndex;
        auth = getAuthByContract(usedContractIndex);
        const closeResults = await closeParcelsByShipmentNumber(auth, params.parcelIds);
        await updateSpedizioniStatus(closeResults.map((r) => ({ parcelId: r.parcelId, success: r.success })), "closed");
        result = closeResults;
        break;
      }

      case "closeOrder": {
        if (params.ordiniIds) {
          result = await closeMultipleOrders(params.ordiniIds);
          const flattened = result.allCloseResults.map((r) => ({ parcelId: r.parcelId, success: r.success }));
          await updateSpedizioniStatus(flattened, "closed");
        } else {
          result = await closeOrderParcels(params.ordiniId);
          usedContractIndex = result.contractIndex;
          const flattened = result.results.map((r) => ({ parcelId: r.parcelId, success: r.success }));
          await updateSpedizioniStatus(flattened, "closed");
        }
        break;
      }

      case "closeMultipleOrders": {
        result = await closeMultipleOrders(params.ordiniIds);
        await updateSpedizioniStatus(result.allCloseResults.map((r) => ({ parcelId: r.parcelId, success: r.success })), "closed");
        break;
      }

      case "delete": {
        usedContractIndex = contractIndex;
        auth = getAuthByContract(usedContractIndex);
        await deleteParcel(auth, params.parcelId);
        await updateSpedizioniStatus([{ parcelId: params.parcelId, success: true }], "deleted");
        result = { parcelId: params.parcelId, deleted: true };
        break;
      }

      case "deleteMultipleOrders": {
        result = await deleteMultipleOrders(params.ordiniIds);
        usedContractIndex = result.contractIndex;
        const flattenedResults = result.allDeleteResults
          .filter((dr) => dr.success)
          .map((dr) => ({ parcelId: dr.parcelId, success: true }));
        if (flattenedResults.length > 0) {
          await updateSpedizioniStatus(flattenedResults, "deleted");
        }
        break;
      }

      case "getZplBySped": {
        if (!params.ordiniId) {
          return { statusCode: 400, payload: { error: "ordiniId parameter is required" } };
        }
        result = await processOrderZpl(params.ordiniId);
        usedContractIndex = result.contractIndex;
        break;
      }

      default:
        return { statusCode: 400, payload: { error: `Unknown action: ${action}` } };
    }

    const payload = { success: true, data: result, contractIndex: usedContractIndex };
    if (auth) {
      payload.contractInfo = { branchId: auth.branchId, clientId: auth.clientId, contractId: auth.contractId };
    }
    return { statusCode: 200, payload };
  } catch (error) {
    console.error("GLS API Error:", error);
    return { statusCode: 500, payload: { success: false, error: error.message } };
  }
}
