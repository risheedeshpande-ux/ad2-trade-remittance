/* ==========================================================================
   AD2 Trade Remittance — fictional seed data
   Every record here is invented. No real customer, bank or transaction data.
   ========================================================================== */

const SEED_VERSION = 'ad2-trade-v1';

/* --- currency master -------------------------------------------------------
   marginMultiplier derives the non-USD margin from the USD margin, per the
   requirements call. USD is the base at 1.0.                                */
const CURRENCIES = [
  { code:'USD', name:'US Dollar',        symbol:'$',  marginMultiplier:1.00, refRate:88.42 },
  { code:'EUR', name:'Euro',             symbol:'€',  marginMultiplier:1.20, refRate:95.87 },
  { code:'GBP', name:'Pound Sterling',   symbol:'£',  marginMultiplier:1.35, refRate:112.64 },
  { code:'AED', name:'UAE Dirham',       symbol:'د.إ',marginMultiplier:0.85, refRate:24.07 },
  { code:'SGD', name:'Singapore Dollar', symbol:'S$', marginMultiplier:1.10, refRate:65.31 },
  { code:'JPY', name:'Japanese Yen',     symbol:'¥',  marginMultiplier:0.60, refRate:0.5872 },
  { code:'CHF', name:'Swiss Franc',      symbol:'Fr', marginMultiplier:1.30, refRate:104.18 },
  { code:'AUD', name:'Australian Dollar',symbol:'A$', marginMultiplier:1.05, refRate:58.44 },
];

const CONSTITUTIONS = [
  'Proprietorship','Partnership','Private Limited','Public Limited',
  'HUF','Individual'   // added per the requirements call
];

/* --- purpose code -> document checklist ------------------------------------
   The defect raised on the call: one shared checklist was served for every
   purpose code, so Business Travel asked for a Bill of Entry. The checklist
   is resolved from the purpose code here. Provisional until the full
   mapping workbook arrives from the business team.                          */
const PURPOSE_CODES = [
  { code:'S0101', label:'Advance payment against imports', direction:'outward', category:'Import',
    docs:[
      {id:'proforma',  name:'Proforma invoice',            required:true },
      {id:'po',        name:'Purchase order',              required:true },
      {id:'a1',        name:'Form A1',                     required:true },
      {id:'undertake', name:'Advance payment undertaking', required:true },
      {id:'contract',  name:'Supply contract',             required:false },
    ]},
  { code:'S0102', label:'Payment towards imports — settlement of invoice', direction:'outward', category:'Import',
    docs:[
      {id:'invoice', name:'Commercial invoice',      required:true },
      {id:'boe',     name:'Bill of Entry',           required:true },
      {id:'transport',name:'Transport document (B/L or AWB)', required:true },
      {id:'a1',      name:'Form A1',                 required:true },
      {id:'packing', name:'Packing list',            required:false },
    ]},
  { code:'S0104', label:'Intermediary trade', direction:'outward', category:'Import',
    docs:[
      {id:'purch',  name:'Purchase contract',  required:true },
      {id:'sale',   name:'Sale contract',      required:true },
      {id:'invoice',name:'Commercial invoice', required:true },
      {id:'a1',     name:'Form A1',            required:true },
    ]},
  { code:'S0190', label:'Imports below INR 5,00,000', direction:'outward', category:'Import',
    docs:[
      {id:'invoice', name:'Commercial invoice', required:true },
      {id:'a1',      name:'Form A1',            required:true },
    ]},
  { code:'S0301', label:'Business travel', direction:'outward', category:'Services',
    docs:[
      {id:'passport',  name:'Passport copy',          required:true },
      {id:'visa',      name:'Visa',                   required:true },
      {id:'itinerary', name:'Travel itinerary',       required:true },
      {id:'empdec',    name:'Employer declaration',   required:true },
      {id:'a2',        name:'Form A2',                required:true },
    ]},
  { code:'S0501', label:'Professional and consultancy fees', direction:'outward', category:'Services',
    docs:[
      {id:'agreement',name:'Service agreement',   required:true },
      {id:'invoice',  name:'Service invoice',     required:true },
      {id:'15ca',     name:'Form 15CA',           required:true },
      {id:'15cb',     name:'Form 15CB',           required:true },
      {id:'a2',       name:'Form A2',             required:true },
    ]},
  { code:'S0601', label:'Freight and logistics charges', direction:'outward', category:'Services',
    docs:[
      {id:'frinv',    name:'Freight invoice',     required:true },
      {id:'transport',name:'Transport document',  required:true },
      {id:'a2',       name:'Form A2',             required:true },
    ]},
  /* inward */
  { code:'P0101', label:'Advance receipt against export contract', direction:'inward', category:'Export',
    docs:[
      {id:'contract', name:'Export contract',      required:true },
      {id:'proforma', name:'Proforma invoice',     required:true },
    ]},
  { code:'P0102', label:'Receipts against export of goods', direction:'inward', category:'Export',
    docs:[
      {id:'invoice',  name:'Export invoice',       required:true },
      {id:'ship',     name:'Shipping bill',        required:true },
      {id:'transport',name:'Transport document',   required:true },
    ]},
  { code:'P0103', label:'Export bills negotiated or discounted', direction:'inward', category:'Export',
    docs:[
      {id:'invoice', name:'Export invoice',        required:true },
      {id:'ship',    name:'Shipping bill',         required:true },
    ]},
  { code:'P0108', label:'Goods sold under merchanting / intermediary trade', direction:'inward', category:'Export',
    docs:[
      {id:'sale',     name:'Sale contract',        required:true },
      {id:'purch',    name:'Purchase contract',    required:true },
      {id:'invoice',  name:'Commercial invoice',   required:true },
    ]},
  { code:'P0802', label:'Receipts for software and IT services', direction:'inward', category:'Services',
    docs:[
      {id:'invoice',   name:'Service invoice',     required:true },
      {id:'softex',    name:'SOFTEX form',         required:true },
      {id:'agreement', name:'Service agreement',   required:false },
    ]},
];

/* --- remittance type ------------------------------------------------------
   The settlement method, separate from the RBI purpose code. Selecting a type
   narrows the purpose codes on offer and can add documents of its own on top
   of the purpose-code checklist.

   Letter-of-credit settlement is deliberately absent: the requirements call
   put trade-finance instruments (LC, documentary credit) out of scope for this
   journey. Add a type here when that changes.                                */
const REMITTANCE_TYPES = [
  /* outward */
  { id:'OUT-ADV',   direction:'outward', label:'Advance payment',
    hint:'Paid before shipment, against a proforma invoice or contract.',
    purposes:['S0101','S0104'],
    /* same id as the S0101 document so the two do not both appear */
    docs:[{ id:'undertake', name:'Advance payment undertaking', required:true }] },
  { id:'OUT-DOC',   direction:'outward', label:'Payment against documents (collection)',
    hint:'Documents routed through the bank — sight (DP) or usance (DA).',
    purposes:['S0102','S0104'],
    docs:[{ id:'collsched', name:'Collection schedule / bank covering letter', required:true }] },
  { id:'OUT-OPEN',  direction:'outward', label:'Open account / direct payment',
    hint:'Post-shipment payment straight to the supplier against an invoice.',
    purposes:['S0102','S0190'], docs:[] },
  { id:'OUT-MERCH', direction:'outward', label:'Merchanting / intermediary trade',
    hint:'Goods bought and sold outside India without entering the country.',
    purposes:['S0104'],
    docs:[{ id:'merchdec', name:'Merchanting trade declaration', required:true }] },
  { id:'OUT-SVC',   direction:'outward', label:'Services, fees and other current account',
    hint:'Non-goods payments — travel, consultancy, freight.',
    purposes:['S0301','S0501','S0601'], docs:[] },

  /* inward */
  { id:'IN-ADV',   direction:'inward', label:'Advance receipt against export order',
    hint:'Received before shipment; shipment must follow within the agreed period.',
    purposes:['P0101'],
    docs:[{ id:'advdec', name:'Advance receipt declaration', required:true }] },
  { id:'IN-DOC',   direction:'inward', label:'Realisation against documents (collection)',
    hint:'Export documents sent for collection and now realised.',
    purposes:['P0102','P0103'],
    docs:[{ id:'colladv', name:'Collection advice', required:true }] },
  { id:'IN-OPEN',  direction:'inward', label:'Open account receipt',
    hint:'Buyer remits directly against the export invoice.',
    purposes:['P0102'], docs:[] },
  { id:'IN-MERCH', direction:'inward', label:'Merchanting / intermediary trade receipt',
    hint:'Sale leg of a merchanting transaction.',
    purposes:['P0108'],
    docs:[{ id:'merchdec', name:'Merchanting trade declaration', required:true }] },
  { id:'IN-SVC',   direction:'inward', label:'Services, fees and other current account',
    hint:'Non-goods receipts — software, consultancy, royalties.',
    purposes:['P0802'], docs:[] },
];

const DISPOSAL_OPTIONS = [
  { id:'knockoff', label:'Knock off against outstanding export bill' },
  { id:'credit',   label:'Credit to bank account' },
];

const CHARGE_CATEGORIES = [
  { id:'txn',    name:'Transaction handling fee' },
  { id:'swift',  name:'SWIFT charge' },
  { id:'nostro', name:'Correspondent bank charge' },
  { id:'doc',    name:'Document handling fee' },
];

/* --- SMEs ---------------------------------------------------------------- */
const SMES = [
  {
    id:'SME-1001', legalName:'Meridian Textiles Private Limited', tradingName:'Meridian Textiles',
    constitution:'Private Limited', incorporationDate:'2016-04-12', regNumber:'U17299MH2016PTC284119',
    country:'India', address:'Unit 4, Parel Industrial Estate, Mumbai 400012',
    domainId:'MERIDIANTEX', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AAFCM4521K', gstin:'27AAFCM4521K1ZP', iec:'0316954218',
    contactName:'Kavita Raghunathan', designation:'Director — Finance',
    email:'kavita@meridiantextiles.example', mobile:'+91 98204 11562',
    industry:'Textiles and apparel', description:'Cotton and blended fabric exporter, supplying EU and UK retail.',
    expectedVolume:'USD 4,000,000', requestedCurrencies:['USD','EUR','GBP'], service:'Both',
    source:'Digital', createdBy:'SME Applicant', status:'Approved',
    submittedAt:'2026-07-02T09:20:00', approvedAt:'2026-07-09T15:42:00',
    config:{
      permission:'Both', currencies:['USD','EUR','GBP'],
      margins:{ USD:50, EUR:60, GBP:68 }, marginBasis:'paise',
      charges:[
        { category:'txn',   name:'Transaction handling fee', basis:'Fixed', value:500, currency:'INR', frequency:'Per transaction' },
        { category:'swift', name:'SWIFT charge',             basis:'Fixed', value:750, currency:'INR', frequency:'Per transaction' },
      ],
      effectiveDate:'2026-07-10', remarks:'Standard SME trade pricing. Reviewed at 12 months.'
    }
  },
  {
    id:'SME-1002', legalName:'Arcadia Components LLP', tradingName:'Arcadia Components',
    constitution:'Partnership', incorporationDate:'2019-11-05', regNumber:'AAL-7732',
    country:'India', address:'Plot 22, Sector 8, Gandhinagar 382008',
    domainId:'ARCADIACOMP', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AAUFA9087H', gstin:'24AAUFA9087H1Z4', iec:'0819337742',
    contactName:'Devansh Mehta', designation:'Managing Partner',
    email:'devansh@arcadiacomponents.example', mobile:'+91 99745 20388',
    industry:'Electronic components', description:'Imports passive components and connectors for domestic assembly.',
    expectedVolume:'USD 2,200,000', requestedCurrencies:['USD','SGD'], service:'Import',
    source:'Offline', createdBy:'AD2 Maker (R. Iyer)', status:'Approved',
    submittedAt:'2026-08-01T11:05:00', approvedAt:'2026-08-06T10:12:00',
    config:{
      permission:'Import', currencies:['USD','SGD'],
      margins:{ USD:55, SGD:61 }, marginBasis:'paise',
      charges:[
        { category:'txn',   name:'Transaction handling fee', basis:'Fixed', value:450, currency:'INR', frequency:'Per transaction' },
        { category:'doc',   name:'Document handling fee',    basis:'Fixed', value:300, currency:'INR', frequency:'Per document set' },
      ],
      effectiveDate:'2026-08-07', remarks:'Import-only. Export permission on request after six months of activity.'
    }
  },
  {
    id:'SME-1003', legalName:'Nilgiri Spice Exports', tradingName:'Nilgiri Spice',
    constitution:'Proprietorship', incorporationDate:'2021-02-18', regNumber:'PROP-NSE-4410',
    country:'India', address:'14 Market Road, Coonoor 643101',
    domainId:'NILGIRISPICE', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AJXPN7741C', gstin:'33AJXPN7741C1ZR', iec:'1021884390',
    contactName:'Suresh Palaniappan', designation:'Proprietor',
    email:'suresh@nilgirispice.example', mobile:'+91 94430 71129',
    industry:'Agricultural commodities', description:'Pepper, cardamom and clove exports to the Gulf and Europe.',
    expectedVolume:'USD 900,000', requestedCurrencies:['USD','AED'], service:'Export',
    source:'Digital', createdBy:'SME Applicant', status:'Approved',
    submittedAt:'2026-08-14T16:40:00', approvedAt:'2026-08-20T12:30:00',
    config:{
      permission:'Export', currencies:['USD','AED'],
      margins:{ USD:45, AED:38 }, marginBasis:'paise',
      charges:[
        { category:'txn', name:'Transaction handling fee', basis:'Fixed', value:400, currency:'INR', frequency:'Per transaction' },
      ],
      effectiveDate:'2026-08-21', remarks:'Export-only, agri commodity concession on handling fee.'
    }
  },
  {
    id:'SME-1004', legalName:'Harikrishna Joint Family Trading (HUF)', tradingName:'HK Trading',
    constitution:'HUF', incorporationDate:'2014-06-30', regNumber:'HUF-HK-2291',
    country:'India', address:'7 Ratan Pol, Ahmedabad 380001',
    domainId:'HKTRADING', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AAAHH2291M', gstin:'24AAAHH2291M1ZK', iec:'',
    contactName:'Harikrishna Patel', designation:'Karta',
    email:'hk@hktrading.example', mobile:'+91 98250 66214',
    industry:'Chemicals and dyes', description:'Dye intermediates, importing from China and Korea.',
    expectedVolume:'USD 1,400,000', requestedCurrencies:['USD'], service:'Import',
    source:'Digital', createdBy:'SME Applicant', status:'Clarification Required',
    submittedAt:'2026-09-15T10:02:00', approvedAt:null, config:null
  },
  {
    id:'SME-1005', legalName:'Ishani Consulting (Individual)', tradingName:'Ishani Consulting',
    constitution:'Individual', incorporationDate:'2023-01-09', regNumber:'IND-IC-8830',
    country:'India', address:'B-303 Lake View, Bengaluru 560103',
    domainId:'ISHANICONS', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AKPPI8830Q', gstin:'29AKPPI8830Q1ZD', iec:'1122556677',
    contactName:'Ishani Bhattacharya', designation:'Proprietor',
    email:'ishani@ishaniconsulting.example', mobile:'+91 90080 34417',
    industry:'Professional services', description:'Engineering design consultancy billing overseas principals.',
    expectedVolume:'USD 300,000', requestedCurrencies:['USD','EUR'], service:'Export',
    source:'Digital', createdBy:'SME Applicant', status:'Under Review',
    submittedAt:'2026-09-18T14:25:00', approvedAt:null, config:null
  },
  {
    id:'SME-1006', legalName:'Caldera Metals Limited', tradingName:'Caldera Metals',
    constitution:'Public Limited', incorporationDate:'2009-03-22', regNumber:'L27100GJ2009PLC055120',
    country:'India', address:'Survey 118, Dahej SEZ, Bharuch 392130',
    domainId:'CALDERAMET', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AABCC5512J', gstin:'24AABCC5512J1ZM', iec:'0909112233',
    contactName:'Ramesh Chandran', designation:'Head of Treasury',
    email:'ramesh@calderametals.example', mobile:'+91 99133 88204',
    industry:'Metals and alloys', description:'Aluminium billet importer and semi-finished exporter.',
    expectedVolume:'USD 7,500,000', requestedCurrencies:['USD','EUR','JPY'], service:'Both',
    source:'Offline', createdBy:'AD2 Maker (R. Iyer)', status:'Submitted',
    submittedAt:'2026-09-20T09:15:00', approvedAt:null, config:null
  },
];

/* --- bank account master (per SME; drives remitter + credit selection) ---- */
const BANK_ACCOUNTS = [
  { id:'BA-001', smeId:'SME-1001', holder:'Meridian Textiles Private Limited', bank:'HDFC Bank', accountNumber:'50200041228734', ifsc:'HDFC0000241', branch:'Parel, Mumbai', currency:'INR', type:'Current', verified:true,  verifiedOn:'2026-07-08', primary:true },
  { id:'BA-002', smeId:'SME-1001', holder:'Meridian Textiles Private Limited', bank:'ICICI Bank', accountNumber:'002105500912',   ifsc:'ICIC0000021', branch:'Lower Parel, Mumbai', currency:'INR', type:'Current', verified:true,  verifiedOn:'2026-07-08', primary:false },
  { id:'BA-003', smeId:'SME-1001', holder:'Meridian Textiles Private Limited', bank:'HDFC Bank', accountNumber:'50200041228990', ifsc:'HDFC0000241', branch:'Parel, Mumbai', currency:'USD', type:'EEFC',    verified:false, verifiedOn:null,        primary:false },
  { id:'BA-004', smeId:'SME-1002', holder:'Arcadia Components LLP', bank:'Axis Bank',  accountNumber:'918020044127310', ifsc:'UTIB0000133', branch:'Gandhinagar', currency:'INR', type:'Current', verified:true, verifiedOn:'2026-08-05', primary:true },
  { id:'BA-005', smeId:'SME-1002', holder:'Arcadia Components LLP', bank:'Kotak Mahindra Bank', accountNumber:'7845102299', ifsc:'KKBK0002611', branch:'Sector 11, Gandhinagar', currency:'INR', type:'Current', verified:false, verifiedOn:null, primary:false },
  { id:'BA-006', smeId:'SME-1003', holder:'Nilgiri Spice Exports', bank:'State Bank of India', accountNumber:'38812044719', ifsc:'SBIN0001440', branch:'Coonoor', currency:'INR', type:'Current', verified:true, verifiedOn:'2026-08-19', primary:true },
  { id:'BA-007', smeId:'SME-1003', holder:'Nilgiri Spice Exports', bank:'State Bank of India', accountNumber:'38812044886', ifsc:'SBIN0001440', branch:'Coonoor', currency:'USD', type:'EEFC', verified:true, verifiedOn:'2026-08-19', primary:false },
];


/* --- beneficiary master ---------------------------------------------------
   Overseas payees held per SME, so a remittance selects one rather than
   retyping bank details each time. A transaction still snapshots the details
   it used, so later edits to the master never rewrite history.             */
const BENEFICIARIES = [
  { id:'BEN-001', smeId:'SME-1001', name:'Filatura Ponti S.p.A.', country:'Italy',
    address:'Via Industria 18, 21052 Busto Arsizio VA', accountNumber:'IT60X0542811101000000123456',
    bank:'Intesa Sanpaolo', bankCountry:'Italy', swift:'BCITITMM', currency:'EUR',
    relationship:'Supplier — yarn and greige fabric', addedBy:'SME User', addedOn:'2026-07-11', lastUsed:'2026-09-19' },
  { id:'BEN-002', smeId:'SME-1001', name:'Northgate Advisory Ltd', country:'United Kingdom',
    address:'4 Finsbury Square, London EC2A 1AB', accountNumber:'GB82WEST12345698765432',
    bank:'Barclays', bankCountry:'United Kingdom', swift:'BARCGB22', currency:'GBP',
    relationship:'Professional services', addedBy:'SME User', addedOn:'2026-08-02', lastUsed:'2026-09-21' },
  { id:'BEN-003', smeId:'SME-1001', name:'Aegis Freight Services Ltd', country:'Singapore',
    address:'12 Keppel Road, Singapore 089059', accountNumber:'0011-882-3390',
    bank:'OCBC Bank', bankCountry:'Singapore', swift:'OCBCSGSG', currency:'USD',
    relationship:'Freight forwarder', addedBy:'SME User', addedOn:'2026-08-14', lastUsed:'2026-09-09' },
  { id:'BEN-004', smeId:'SME-1001', name:'Bergmann Textilhandel GmbH', country:'Germany',
    address:'Hafenstrasse 22, 20359 Hamburg', accountNumber:'DE89370400440532013000',
    bank:'Commerzbank', bankCountry:'Germany', swift:'COBADEFF', currency:'EUR',
    relationship:'Buyer — also a payee for credit notes', addedBy:'AD2 Maker (R. Iyer)', addedOn:'2026-09-02', lastUsed:null },
  { id:'BEN-005', smeId:'SME-1002', name:'Shenzhen Ruiyang Electronics', country:'China',
    address:'Block C, Bao an District, Shenzhen 518101', accountNumber:'6222021001128845',
    bank:'Bank of China', bankCountry:'China', swift:'BKCHCNBJ', currency:'USD',
    relationship:'Supplier — passive components', addedBy:'SME User', addedOn:'2026-08-08', lastUsed:'2026-09-21' },
  { id:'BEN-006', smeId:'SME-1002', name:'Ruiyang Precision Pte Ltd', country:'Singapore',
    address:'8 Tuas Avenue 3, Singapore 639407', accountNumber:'0033-991-4471',
    bank:'DBS Bank', bankCountry:'Singapore', swift:'DBSSSGSG', currency:'SGD',
    relationship:'Supplier — connectors', addedBy:'SME User', addedOn:'2026-08-20', lastUsed:'2026-09-14' },
  { id:'BEN-007', smeId:'SME-1003', name:'Cochin Port Logistics FZE', country:'United Arab Emirates',
    address:'Jebel Ali Free Zone, Dubai', accountNumber:'AE070331234567890123456',
    bank:'Emirates NBD', bankCountry:'United Arab Emirates', swift:'EBILAEAD', currency:'AED',
    relationship:'Freight and handling', addedBy:'SME User', addedOn:'2026-09-01', lastUsed:null },
];

/* --- bills ---------------------------------------------------------------- */
const BILLS = [
  { id:'BL-24001', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0141', invoiceDate:'2026-07-18', counterparty:'Halstead Retail Group', counterpartyCountry:'United Kingdom', currency:'GBP', amount:184500, adjusted:184500, outstanding:0,      dueDate:'2026-10-16', orderRef:'PO-HRG-88213', shipmentRef:'SB-2261194', source:'Form fill', review:'Accepted', settlement:'Settled' },
  { id:'BL-24002', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0152', invoiceDate:'2026-08-04', counterparty:'Bergmann Textilhandel GmbH', counterpartyCountry:'Germany', currency:'EUR', amount:226800, adjusted:120000, outstanding:106800, dueDate:'2026-11-02', orderRef:'PO-BTH-4417', shipmentRef:'SB-2274410', source:'SAP API', review:'Accepted', settlement:'Partially Settled' },
  { id:'BL-24003', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0163', invoiceDate:'2026-08-27', counterparty:'Halstead Retail Group', counterpartyCountry:'United Kingdom', currency:'GBP', amount:97200,  adjusted:0,      outstanding:97200,  dueDate:'2026-11-25', orderRef:'PO-HRG-88407', shipmentRef:'SB-2288305', source:'SFTP', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24004', smeId:'SME-1001', type:'Import', invoiceNumber:'SUP-IT-99021', invoiceDate:'2026-09-01', counterparty:'Filatura Ponti S.p.A.', counterpartyCountry:'Italy', currency:'EUR', amount:88400, adjusted:0, outstanding:88400, dueDate:'2026-10-31', orderRef:'MTX-PO-2211', shipmentRef:'BOE-7745120', source:'Form fill', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24005', smeId:'SME-1001', type:'Import', invoiceNumber:'SUP-IT-99044', invoiceDate:'2026-09-12', counterparty:'Filatura Ponti S.p.A.', counterpartyCountry:'Italy', currency:'EUR', amount:64100, adjusted:0, outstanding:64100, dueDate:'2026-11-11', orderRef:'MTX-PO-2240', shipmentRef:'', source:'CSV upload', review:'Under Review', settlement:'Unsettled' },
  { id:'BL-24006', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5512', invoiceDate:'2026-08-22', counterparty:'Shenzhen Ruiyang Electronics', counterpartyCountry:'China', currency:'USD', amount:142300, adjusted:142300, outstanding:0, dueDate:'2026-10-21', orderRef:'ARC-PO-771', shipmentRef:'BOE-7731088', source:'SAP API', review:'Accepted', settlement:'Settled' },
  { id:'BL-24007', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5528', invoiceDate:'2026-09-09', counterparty:'Ruiyang Precision Pte Ltd', counterpartyCountry:'Singapore', currency:'SGD', amount:98750, adjusted:40000, outstanding:58750, dueDate:'2026-11-08', orderRef:'ARC-PO-784', shipmentRef:'BOE-7749221', source:'SAP API', review:'Accepted', settlement:'Partially Settled' },
  { id:'BL-24008', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5533', invoiceDate:'2026-09-17', counterparty:'Shenzhen Ruiyang Electronics', counterpartyCountry:'China', currency:'USD', amount:76900, adjusted:0, outstanding:76900, dueDate:'2026-11-16', orderRef:'ARC-PO-790', shipmentRef:'', source:'Form fill', review:'Query Raised', settlement:'Unsettled' },
  { id:'BL-24009', smeId:'SME-1003', type:'Export', invoiceNumber:'NSE/EX/2026/318', invoiceDate:'2026-08-29', counterparty:'Gulf Spice Trading LLC', counterpartyCountry:'United Arab Emirates', currency:'AED', amount:412000, adjusted:180000, outstanding:232000, dueDate:'2026-11-27', orderRef:'GST-PO-1190', shipmentRef:'SB-2290117', source:'Form fill', review:'Accepted', settlement:'Partially Settled' },
  { id:'BL-24010', smeId:'SME-1003', type:'Export', invoiceNumber:'NSE/EX/2026/324', invoiceDate:'2026-09-11', counterparty:'Aroma Europe BV', counterpartyCountry:'Netherlands', currency:'USD', amount:88600, adjusted:0, outstanding:88600, dueDate:'2026-12-10', orderRef:'AEB-PO-556', shipmentRef:'SB-2298820', source:'CSV upload', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24011', smeId:'SME-1003', type:'Export', invoiceNumber:'NSE/EX/2026/331', invoiceDate:'2026-09-19', counterparty:'Gulf Spice Trading LLC', counterpartyCountry:'United Arab Emirates', currency:'AED', amount:156400, adjusted:0, outstanding:156400, dueDate:'2026-12-18', orderRef:'GST-PO-1204', shipmentRef:'', source:'Form fill', review:'Draft', settlement:'Unsettled' },
];

/* --- outward remittances -------------------------------------------------- */
const OUTWARD = [
  { id:'OR-5101', beneficiaryId:'BEN-005', smeId:'SME-1002', beneficiary:'Shenzhen Ruiyang Electronics', beneficiaryCountry:'China',
    beneficiaryAccount:'6222021001128845', beneficiaryBank:'Bank of China', beneficiaryBankCountry:'China', swift:'BKCHCNBJ',
    currency:'USD', amount:142300, purposeCode:'S0102', remittanceType:'OUT-DOC', executionDate:'2026-09-08', debitAccountId:'BA-004',
    referenceNumber:'ARC-REM-0921', status:'Completed', requestDate:'2026-09-05T10:12:00',
    rate:{ mode:'booked', refRate:88.18, margin:55, customerRate:88.73, bookedAt:'2026-09-05T10:30:00', expiresAt:'2026-09-07T10:30:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:450},{name:'Document handling fee',amount:300}],
    allocations:[{billId:'BL-24006', amount:142300}], pendingWith:'—' },
  { id:'OR-5102', beneficiaryId:'BEN-006', smeId:'SME-1002', beneficiary:'Ruiyang Precision Pte Ltd', beneficiaryCountry:'Singapore',
    beneficiaryAccount:'0033-991-4471', beneficiaryBank:'DBS Bank', beneficiaryBankCountry:'Singapore', swift:'DBSSSGSG',
    currency:'SGD', amount:40000, purposeCode:'S0102', remittanceType:'OUT-DOC', executionDate:'2026-09-16', debitAccountId:'BA-004',
    referenceNumber:'ARC-REM-0934', status:'Processing', requestDate:'2026-09-14T09:40:00',
    rate:{ mode:'deal', refRate:65.12, margin:61, customerRate:65.73, bookedAt:null, expiresAt:null, dealRef:'FXD-2026-77412' },
    charges:[{name:'Transaction handling fee',amount:450}],
    allocations:[{billId:'BL-24007', amount:40000}], pendingWith:'AD2 Operations' },
  { id:'OR-5103', beneficiaryId:'BEN-001', smeId:'SME-1001', beneficiary:'Filatura Ponti S.p.A.', beneficiaryCountry:'Italy',
    beneficiaryAccount:'IT60X0542811101000000123456', beneficiaryBank:'Intesa Sanpaolo', beneficiaryBankCountry:'Italy', swift:'BCITITMM',
    currency:'EUR', amount:88400, purposeCode:'S0102', remittanceType:'OUT-DOC', executionDate:'2026-09-25', debitAccountId:'BA-001',
    referenceNumber:'MTX-REM-1142', status:'Under Review', requestDate:'2026-09-19T15:05:00',
    rate:{ mode:'booked', refRate:95.71, margin:60, customerRate:96.31, bookedAt:'2026-09-19T15:20:00', expiresAt:'2026-09-21T15:20:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:500},{name:'SWIFT charge',amount:750}],
    allocations:[{billId:'BL-24004', amount:88400}], pendingWith:'AD2 Operations' },
  { id:'OR-5104', smeId:'SME-1001', beneficiary:'Kavita Raghunathan', beneficiaryCountry:'United Kingdom',
    beneficiaryAccount:'GB29NWBK60161331926819', beneficiaryBank:'NatWest', beneficiaryBankCountry:'United Kingdom', swift:'NWBKGB2L',
    currency:'GBP', amount:4200, purposeCode:'S0301', remittanceType:'OUT-SVC', executionDate:'2026-09-29', debitAccountId:'BA-001',
    referenceNumber:'MTX-TRV-0088', status:'Clarification Required', requestDate:'2026-09-20T11:30:00',
    rate:{ mode:'none', refRate:112.64, margin:68, customerRate:113.32, bookedAt:null, expiresAt:null, dealRef:null },
    charges:[{name:'Transaction handling fee',amount:500}],
    allocations:[], pendingWith:'SME',
    query:{ question:'Visa copy is expired. Please upload a current visa and confirm travel dates.', raisedBy:'AD2 Operations', raisedAt:'2026-09-21T09:15:00', response:null } },
  { id:'OR-5105', beneficiaryId:'BEN-002', smeId:'SME-1001', beneficiary:'Northgate Advisory Ltd', beneficiaryCountry:'United Kingdom',
    beneficiaryAccount:'GB82WEST12345698765432', beneficiaryBank:'Barclays', beneficiaryBankCountry:'United Kingdom', swift:'BARCGB22',
    currency:'GBP', amount:15800, purposeCode:'S0501', remittanceType:'OUT-SVC', executionDate:'2026-10-02', debitAccountId:'BA-002',
    referenceNumber:'', status:'Draft', requestDate:'2026-09-21T16:45:00',
    rate:{ mode:'none', refRate:112.64, margin:68, customerRate:113.32, bookedAt:null, expiresAt:null, dealRef:null },
    charges:[{name:'Transaction handling fee',amount:500}], allocations:[], pendingWith:'SME' },
  { id:'OR-5106', beneficiaryId:'BEN-005', smeId:'SME-1002', beneficiary:'Shenzhen Ruiyang Electronics', beneficiaryCountry:'China',
    beneficiaryAccount:'6222021001128845', beneficiaryBank:'Bank of China', beneficiaryBankCountry:'China', swift:'BKCHCNBJ',
    currency:'USD', amount:76900, purposeCode:'S0101', remittanceType:'OUT-ADV', executionDate:'2026-09-30', debitAccountId:'BA-004',
    referenceNumber:'ARC-ADV-0012', status:'Submitted', requestDate:'2026-09-21T12:20:00',
    rate:{ mode:'booked', refRate:88.42, margin:55, customerRate:88.97, bookedAt:'2026-09-21T12:35:00', expiresAt:'2026-09-23T12:35:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:450}],
    allocations:[{billId:'BL-24008', amount:76900}], pendingWith:'AD2 Maker' },
  { id:'OR-5107', beneficiaryId:'BEN-003', smeId:'SME-1001', beneficiary:'Aegis Freight Services Ltd', beneficiaryCountry:'Singapore',
    beneficiaryAccount:'0011-882-3390', beneficiaryBank:'OCBC Bank', beneficiaryBankCountry:'Singapore', swift:'OCBCSGSG',
    currency:'USD', amount:9400, purposeCode:'S0601', remittanceType:'OUT-SVC', executionDate:'2026-09-12', debitAccountId:'BA-001',
    referenceNumber:'MTX-FRT-0451', status:'Rejected', requestDate:'2026-09-09T13:00:00',
    rate:{ mode:'none', refRate:88.30, margin:50, customerRate:88.80, bookedAt:null, expiresAt:null, dealRef:null },
    charges:[{name:'Transaction handling fee',amount:500}], allocations:[], pendingWith:'—',
    rejectReason:'Freight invoice does not match the transport document reference. Resubmit with matching documents.' },
];

/* --- inward remittances --------------------------------------------------- */
const INWARD = [
  { id:'IR-3301', smeId:'SME-1001', reference:'SWF-INW-772104', valueDate:'2026-09-03', remitter:'Halstead Retail Group',
    remitterCountry:'United Kingdom', currency:'GBP', amount:184500, available:0, status:'Processed',
    purposeCode:'P0102', remittanceType:'IN-DOC', remarks:'Full settlement of invoice MTX/EXP/2026/0141', firc:'FIRC-2026-118842' },
  { id:'IR-3302', smeId:'SME-1001', reference:'SWF-INW-773990', valueDate:'2026-09-10', remitter:'Bergmann Textilhandel GmbH',
    remitterCountry:'Germany', currency:'EUR', amount:120000, available:0, status:'Processed',
    purposeCode:'P0102', remittanceType:'IN-DOC', remarks:'Part payment against MTX/EXP/2026/0152', firc:'FIRC-2026-119017' },
  { id:'IR-3303', smeId:'SME-1001', reference:'SWF-INW-775612', valueDate:'2026-09-18', remitter:'Halstead Retail Group',
    remitterCountry:'United Kingdom', currency:'GBP', amount:97200, available:97200, status:'Awaiting Instruction',
    purposeCode:'P0102', remittanceType:'IN-DOC', remarks:'', firc:null },
  { id:'IR-3304', smeId:'SME-1003', reference:'SWF-INW-776201', valueDate:'2026-09-19', remitter:'Gulf Spice Trading LLC',
    remitterCountry:'United Arab Emirates', currency:'AED', amount:180000, available:0, status:'Processed',
    purposeCode:'P0102', remittanceType:'IN-DOC', remarks:'Part settlement NSE/EX/2026/318', firc:'FIRC-2026-119204' },
  { id:'IR-3305', smeId:'SME-1003', reference:'SWF-INW-777845', valueDate:'2026-09-21', remitter:'Aroma Europe BV',
    remitterCountry:'Netherlands', currency:'USD', amount:88600, available:88600, status:'Awaiting Instruction',
    purposeCode:'P0102', remittanceType:'IN-DOC', remarks:'', firc:null },
  { id:'IR-3306', smeId:'SME-1003', reference:'SWF-INW-778990', valueDate:'2026-09-22', remitter:'Gulf Spice Trading LLC',
    remitterCountry:'United Arab Emirates', currency:'AED', amount:232000, available:112000, status:'Instruction Submitted',
    purposeCode:'P0102', remittanceType:'IN-DOC', remarks:'Balance against NSE/EX/2026/318', firc:null },
];

/* --- disposal instructions ------------------------------------------------ */
const DISPOSALS = [
  { id:'DI-9001', inwardId:'IR-3301', smeId:'SME-1001', amount:184500, currency:'GBP',
    creditAccountId:'BA-001', allocations:[{billId:'BL-24001', amount:184500}],
    rate:{ mode:'booked', refRate:112.40, margin:68, customerRate:111.72, bookedAt:'2026-09-03T11:00:00', dealRef:null },
    purposeCode:'P0102', remittanceType:'IN-DOC',
    status:'Processed', submittedAt:'2026-09-03T10:40:00', remarks:'' },
  { id:'DI-9002', inwardId:'IR-3302', smeId:'SME-1001', amount:120000, currency:'EUR',
    creditAccountId:'BA-001', allocations:[{billId:'BL-24002', amount:120000}],
    rate:{ mode:'deal', refRate:95.60, margin:60, customerRate:95.00, bookedAt:null, dealRef:'FXD-2026-77188' },
    purposeCode:'P0102', remittanceType:'IN-OPEN',
    status:'Processed', submittedAt:'2026-09-10T14:20:00', remarks:'Rate negotiated with treasury desk.' },
  { id:'DI-9003', inwardId:'IR-3306', smeId:'SME-1003', amount:120000, currency:'AED',
    creditAccountId:'BA-006', allocations:[{billId:'BL-24009', amount:120000}],
    rate:{ mode:'booked', refRate:24.07, margin:38, customerRate:23.69, bookedAt:'2026-09-22T09:50:00', dealRef:null },
    purposeCode:'P0102', remittanceType:'IN-DOC',
    status:'Under Review', submittedAt:'2026-09-22T09:45:00', remarks:'Partial disposal; balance to follow.' },
];

/* --- integration jobs ----------------------------------------------------- */
const JOBS = [
  { id:'JOB-7741', smeId:'SME-1002', source:'SAP API',  runAt:'2026-09-21T02:00:00', received:14, accepted:13, rejected:1,
    errors:[{row:'ACX-IMP-5541', message:'Currency THB is not enabled for this SME'}] },
  { id:'JOB-7740', smeId:'SME-1001', source:'SFTP',     runAt:'2026-09-20T23:30:00', received:6,  accepted:6,  rejected:0, errors:[] },
  { id:'JOB-7739', smeId:'SME-1002', source:'SAP API',  runAt:'2026-09-20T02:00:00', received:9,  accepted:7,  rejected:2,
    errors:[
      {row:'ACX-IMP-5528', message:'Duplicate external reference — bill already lodged as BL-24007'},
      {row:'ACX-IMP-5536', message:'Invoice date is later than the due date'}
    ] },
  { id:'JOB-7738', smeId:'SME-1003', source:'CSV upload', runAt:'2026-09-19T11:14:00', received:4, accepted:3, rejected:1,
    errors:[{row:'4', message:'Counterparty country is required'}] },
];

/* --- activity / audit ----------------------------------------------------- */
const AUDIT = [
  { id:'AU-1', record:'SME-1001', actor:'AD2 Checker (S. Nair)',  action:'Application approved with pricing configuration', at:'2026-07-09T15:42:00' },
  { id:'AU-2', record:'SME-1001', actor:'AD2 Maker (R. Iyer)',    action:'Pricing prepared — USD 50p, EUR 60p, GBP 68p',    at:'2026-07-09T14:10:00' },
  { id:'AU-3', record:'OR-5103',  actor:'SME User (Meridian)',    action:'Rate booked at 96.31, valid 48 hours',            at:'2026-09-19T15:20:00' },
  { id:'AU-4', record:'OR-5104',  actor:'AD2 Operations',         action:'Clarification raised — expired visa',             at:'2026-09-21T09:15:00' },
  { id:'AU-5', record:'BL-24007', actor:'Integration (SAP API)',  action:'Bill lodged from synchronisation job JOB-7739',   at:'2026-09-09T02:04:00' },
  { id:'AU-6', record:'DI-9003',  actor:'SME User (Nilgiri)',     action:'Partial disposal instruction submitted',          at:'2026-09-22T09:45:00' },
];

/* --- demo accounts (simulated; no real credentials) ----------------------- */
const ACCOUNTS = [
  { domainId:'MERIDIANTEX', loginId:'SMEUSER',  role:'SME User',           smeId:'SME-1001', name:'Kavita Raghunathan' },
  { domainId:'ARCADIACOMP', loginId:'SMEUSER',  role:'SME User',           smeId:'SME-1002', name:'Devansh Mehta' },
  { domainId:'NILGIRISPICE',loginId:'SMEUSER',  role:'SME User',           smeId:'SME-1003', name:'Suresh Palaniappan' },
  { domainId:'HKTRADING',   loginId:'APPLICANT',role:'SME Applicant',      smeId:'SME-1004', name:'Harikrishna Patel' },
  { domainId:'AD2',         loginId:'MAKER',    role:'AD2 Maker',          smeId:null,       name:'Rohit Iyer' },
  { domainId:'AD2',         loginId:'CHECKER',  role:'AD2 Checker',        smeId:null,       name:'Shalini Nair' },
  { domainId:'AD2',         loginId:'OPS',      role:'AD2 Operations',     smeId:null,       name:'Farhan Qureshi' },
  { domainId:'AD2',         loginId:'ADMIN',    role:'AD2 Administrator',  smeId:null,       name:'Admin A' },
];

const SEED = {
  version:SEED_VERSION,
  currencies:CURRENCIES, constitutions:CONSTITUTIONS, purposeCodes:PURPOSE_CODES,
  remittanceTypes:REMITTANCE_TYPES,
  disposalOptions:DISPOSAL_OPTIONS, chargeCategories:CHARGE_CATEGORIES,
  smes:SMES, accounts:BANK_ACCOUNTS, beneficiaries:BENEFICIARIES, bills:BILLS, outward:OUTWARD, inward:INWARD,
  disposals:DISPOSALS, jobs:JOBS, audit:AUDIT, logins:ACCOUNTS,
};
