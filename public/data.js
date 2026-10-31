/* ==========================================================================
   AD2 Trade Remittance — master and seed data
   Every record here is invented. No real customer, bank or transaction data.
   Loaded by the browser (window globals) and by the API (module.exports).
   ========================================================================== */

/* Bump this whenever the shape of SEED changes. A stored state with another
   version is discarded and reseeded. */
const SEED_VERSION = 'ad2-trade-v13';

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

/* --- purpose codes ----------------------------------------------------------
   Source: the business team's workbook "Purpose / Doc Policy" (Purpose sheet).
   Only the codes AD2 is approved to handle are listed. Duplicate rows were
   merged (S0801 and S0802 appeared twice under OTT with different wording)
   and descriptions were tidied (spacing, "slews" -> "news", "lostel" ->
   "hostel"). A code may sit under more than one product.                     */
const PURPOSE_CODES = [
  { code:"S0001", label:"Indian investment abroad — in equity capital (shares)" },
  { code:"S0003", label:"Indian investment abroad — in branches" },
  { code:"S0005", label:"Indian investment abroad — in real estate" },
  { code:"S0007", label:"Repatriation of foreign direct investment in India — in debt securities" },
  { code:"S0009", label:"Repatriation of foreign portfolio investment in India — in equity shares" },
  { code:"S0011", label:"Loans extended to non-residents" },
  { code:"S0012", label:"Repayment of loans received from non-residents (long and medium term loans)" },
  { code:"S0014", label:"Repatriation of non-resident deposits (FCNRB / NRERA etc.)" },
  { code:"S0020", label:"Payments on account of margin payments, premium payment and settlement amount etc. under financial derivative transactions" },
  { code:"S0092", label:"Sales to other ADs in India" },
  { code:"S0093", label:"Sales to overseas banks and correspondents (currency-wise totals)" },
  { code:"S0101", label:"Advance payment against imports made to countries other than Nepal and Bhutan" },
  { code:"S0102", label:"Payment towards imports — settlement of invoice other than Nepal and Bhutan" },
  { code:"S0103", label:"Imports by diplomatic missions other than Nepal and Bhutan" },
  { code:"S0104", label:"Intermediary trade / transit trade, i.e. third-country export passing through India" },
  { code:"S0109", label:"Payments made for imports from Nepal and Bhutan" },
  { code:"S0201", label:"Payments for surplus freight / passenger fare by foreign shipping companies operating in India" },
  { code:"S0202", label:"Payment for operating expenses of Indian shipping companies operating abroad" },
  { code:"S0203", label:"Freight on imports — Shipping companies" },
  { code:"S0204", label:"Freight on exports — Shipping companies" },
  { code:"S0205", label:"Operational leasing (with crew) — Shipping companies" },
  { code:"S0206", label:"Booking of passages abroad — Shipping companies" },
  { code:"S0207", label:"Payments for surplus freight / passenger fare by foreign airlines companies operating in India" },
  { code:"S0208", label:"Operating expenses of Indian Airlines companies operating abroad" },
  { code:"S0209", label:"Freight on imports — Airlines companies" },
  { code:"S0210", label:"Freight on exports — Airlines companies" },
  { code:"S0211", label:"Operational leasing (with crew) — Airlines companies" },
  { code:"S0212", label:"Booking of passages abroad — Airlines companies" },
  { code:"S0214", label:"Payments on account of stevedoring, demurrage, port handling charges etc.(Shipping companies)" },
  { code:"S0215", label:"Payments on account of stevedoring, demurrage, port handling charges, etc.(Airlines companies)" },
  { code:"S0216", label:"Payments for Passenger — Shipping companies" },
  { code:"S0217", label:"Other payments by Shipping companies" },
  { code:"S0218", label:"Payments for Passenger — Airlines companies" },
  { code:"S0219", label:"Other Payments by Airlines companies" },
  { code:"S0220", label:"Payments on account of freight under other modes of transport (Internal Waterways, Roadways, Railways, Pipeline transports and others)" },
  { code:"S0221", label:"Payments on account of passenger fare under other modes of transport (Internal Waterways, Roadways, Railways, Pipeline transports and others)" },
  { code:"S0222", label:"Postal and courier services by air" },
  { code:"S0223", label:"Postal and courier services by sea" },
  { code:"S0224", label:"Postal and courier services by others" },
  { code:"S0301", label:"Remittance towards business travel" },
  { code:"S0303", label:"Travel for pilgrimage" },
  { code:"S0304", label:"Travel for medical treatment" },
  { code:"S0305", label:"Travel for education (including fees, hostel expenses etc.)" },
  { code:"S0306", label:"Other travel (international credit cards)" },
  { code:"S0501", label:"Construction of projects abroad by Indian companies including import of goods at project site" },
  { code:"S0502", label:"Payments for cost of construction etc. of projects executed by foreign companies in India" },
  { code:"S0601", label:"Payments for Life insurance premium" },
  { code:"S0602", label:"Freight insurance — relating to import and export of goods" },
  { code:"S0603", label:"Other general insurance premium" },
  { code:"S0605", label:"Auxiliary services (commission on insurance)" },
  { code:"S0607", label:"Insurance claim Settlement of non-life insurance; and life insurance (only term insurance)" },
  { code:"S0608", label:"Life Insurance Claim Settlements" },
  { code:"S0609", label:"Standardised guarantee services" },
  { code:"S0610", label:"Premium for pension funds" },
  { code:"S0611", label:"Periodic pension entitlements e.g. monthly quarterly or yearly payments of pension amounts by Indian Pension Fund Companies" },
  { code:"S0612", label:"Invoking of standardised guarantees" },
  { code:"S0701", label:"Financial intermediation except investment banking — Bank charges, collection charges, LC charges, cancellation of forward contracts, commission on financial leasing etc" },
  { code:"S0702", label:"Investment banking — brokerage, underwriting commission etc" },
  { code:"S0703", label:"Auxiliary services — charges on operation and regulatory fees, custodial services, depository services etc" },
  { code:"S0801", label:"Hardware consultancy / implementation" },
  { code:"S0802", label:"Software consultancy / implementation" },
  { code:"S0803", label:"Data base, data processing charges" },
  { code:"S0804", label:"Repair and maintenance of computer And software" },
  { code:"S0805", label:"News agency services" },
  { code:"S0806", label:"Other information services-Subscription to newspapers, periodicals" },
  { code:"S0807", label:"Off-site software imports" },
  { code:"S0808", label:"Telecommunication services including electronic mail services and voice mail services" },
  { code:"S0809", label:"Satellite services including space shuttle and rockets etc" },
  { code:"S0901", label:"Franchises services — patents, copyrights, trade marks, industrial processes, franchises etc" },
  { code:"S0902", label:"Payment for use, through licensing arrangements, of produced originals or prototypes (such as manuscripts and films)" },
  { code:"S1002", label:"Trade related services — commission on exports / imports" },
  { code:"S1003", label:"Operational leasing services (other than financial leasing) without operating crew, including charter hire" },
  { code:"S1004", label:"Legal services" },
  { code:"S1005", label:"Accounting, auditing, book keeping and tax consulting services" },
  { code:"S1006", label:"Business and management consultancy and public relations services" },
  { code:"S1007", label:"Advertising, trade fair, market research and public opinion polling services" },
  { code:"S1008", label:"Research and Development services" },
  { code:"S1009", label:"Architectural, engineering and other technical services" },
  { code:"S1010", label:"Agricultural, mining and on-site processing services — protection against insects and disease, increasing of harvest yields, forestry services, mining services like analysis of ores etc" },
  { code:"S1011", label:"Payments for maintenance of offices Abroad" },
  { code:"S1013", label:"Environmental services" },
  { code:"S1014", label:"Engineering Services" },
  { code:"S1015", label:"Tax consulting services" },
  { code:"S1016", label:"Market research and public opinion polling service" },
  { code:"S1017", label:"Publishing and printing services" },
  { code:"S1018", label:"Mining services like on–site processing services analysis of ores etc" },
  { code:"S1020", label:"Commission agent services" },
  { code:"S1021", label:"Wholesale and retailing trade services" },
  { code:"S1022", label:"Operational leasing services (other than financial leasing) without operating crew, including charter hire — Shipping companies" },
  { code:"S1023", label:"Other Technical Services including scientific/space services" },
  { code:"S1101", label:"Audio-visual and related services — services and associated fees related to production of motion pictures, rentals, fees received by actors, directors, producers and fees for distribution rights" },
  { code:"S1103", label:"Radio and television production, distribution and transmission services" },
  { code:"S1104", label:"Entertainment services" },
  { code:"S1105", label:"Museums, library and archival services" },
  { code:"S1106", label:"Recreation and sporting activities services" },
  { code:"S1107", label:"Education (e.g. fees for corr. courses abroad)" },
  { code:"S1108", label:"Health Service (payment towards services received from hospitals, doctors, nurses, paramedical and similar services etc. rendered remotely or on-site)" },
  { code:"S1109", label:"Other Personal, Cultural and Recreational services" },
  { code:"S1201", label:"Maintenance of Indian embassies abroad" },
  { code:"S1202", label:"Remittances by foreign embassies in India" },
  { code:"S1306", label:"Remittance towards payment / refund of taxes" },
  { code:"S1401", label:"Compensation of employees" },
  { code:"S1402", label:"Remittance towards interest on non-resident deposits (FCNRB / NRERA / NRNRD / NRSR etc.)" },
  { code:"S1501", label:"Refunds / rebates / reduction in invoice value on account of exports" },
  { code:"S1502", label:"Reversal of wrong entries, refunds of amount remitted for non-exports" },
  { code:"S1503", label:"Payments by residents for international bidding" },
  { code:"S1504", label:"Crystallize/Cancel export bills" },
  { code:"S1505", label:"Deemed imports (exports between SEZ, EPZs and domestic tariff areas)" },
  { code:"S1601", label:"Payments on account of maintenance and repair services rendered for Vessels, ships, boats, warships, etc" },
  { code:"S1602", label:"Payments on account of maintenance and repair services rendered for aircrafts, space shuttles, rockets, military aircrafts, helicopters, etc" },
  { code:"S1701", label:"Payments for processing of goods" },
];

/* --- products ---------------------------------------------------------------
   The product code selected on a transaction. It narrows the purpose codes on
   offer and carries the document policy. From the workbook: AIR, DIR and OTT
   for outward remittance, TRADE for disposal instructions on inward receipts.

   bills: whether import/export bills are linked on the transaction —
   'required' (the payment settles a lodged bill), 'optional', or 'none'.     */
const PRODUCTS = [
  { id:'AIR', direction:'outward', label:'Advance Import Remittance',
    hint:'Paid before the goods ship, against a proforma invoice. The Bill of Entry follows once the goods clear customs.',
    bills:'none', purposes:['S0101','S0104','S0109','S1505'] },
  { id:'DIR', direction:'outward', label:'Direct Import Remittance',
    hint:'Paid after shipment against the commercial invoice, transport document and Bill of Entry. Settles a lodged import bill.',
    bills:'required', purposes:['S0101','S0102','S0104','S0109','S0501','S1505'] },
  { id:'OTT', direction:'outward', label:'Miscellaneous Remittance',
    hint:'Services, fees and other current-account payments.',
    bills:'optional', purposes:['S0001','S0003','S0005','S0007','S0009','S0011','S0012','S0014','S0020','S0092','S0093','S0101','S0102','S0103','S0109','S0201','S0202','S0203','S0204','S0205','S0206','S0207','S0208','S0209','S0210','S0211','S0212','S0214','S0215','S0216','S0217','S0218','S0219','S0220','S0221','S0222','S0223','S0224','S0301','S0303','S0304','S0305','S0306','S0501','S0502','S0601','S0602','S0603','S0605','S0607','S0608','S0609','S0610','S0611','S0612','S0701','S0702','S0703','S0801','S0802','S0803','S0804','S0805','S0806','S0807','S0808','S0809','S0901','S0902','S1002','S1003','S1004','S1005','S1006','S1007','S1008','S1009','S1010','S1011','S1013','S1014','S1015','S1016','S1017','S1018','S1020','S1021','S1022','S1023','S1101','S1103','S1104','S1105','S1106','S1107','S1108','S1109','S1201','S1202','S1306','S1401','S1402','S1501','S1502','S1503','S1504','S1505','S1601','S1602','S1701'] },
  /* Added on review (22 Sep): LC settlement as a remittance type. Not in the
     workbook, so the Administrator can switch its codes off. */
  { id:'LC', direction:'outward', label:'Letter of Credit Settlement',
    hint:'Payment under an import letter of credit, against the documents presented under the LC. Settles a lodged import bill.',
    bills:'required', purposes:['S0101','S0102','S0104','S0109','S1505'], added:true },
  { id:'TRADE', direction:'inward', label:'Trade',
    hint:'Export proceeds: knock off lodged export bills, or credit now as an advance and knock off later.',
    bills:'optional', purposes:[] },
];

/* --- inward purpose and disposal options -------------------------------------
   The workbook's disposal sheet names the product, TRADE. Each disposal also
   carries the RBI inward purpose code (P-code) that is reported with the
   FIRC. The Administrator can add more. Disposal options are the BRD's
   "AD2-configured list".                                                    */
const INWARD_PURPOSES = [
  { code:'P0101', label:'Value of export bills negotiated, purchased or discounted' },
  { code:'P0102', label:'Realisation of export bills sent on collection (full invoice value)' },
  { code:'P0103', label:'Advance receipts against export contracts (export of goods only)' },
  { code:'P0104', label:'Receipts against export of goods not covered by an EDF or SOFTEX form' },
  { code:'P0108', label:'Receipts for goods sold under merchanting (export leg of merchanting trade)' },
  { code:'P0802', label:'Software consultancy and implementation' },
  { code:'P0807', label:'Off-site software exports' },
  { code:'P1006', label:'Business and management consultancy and public relations services' },
  { code:'P1008', label:'Architectural, engineering and other technical services' },
];
const DISPOSAL_OPTIONS = [
  { id:'knockoff', label:'Knock off against export bills',
    hint:'Apply the amount to lodged export bills. Any part not applied is credited and tracked as a FIRC pending knock-off.' },
  { id:'advance',  label:'Credit as advance — knock off later',
    hint:'Credit the whole amount now (advance receipt before shipment, or bill not yet lodged). The FIRC is knocked off against bills later.' },
];

/* --- compliance rules ---------------------------------------------------------
   Every outward request and disposal instruction is scored when submitted.
   Score >= 60 is High (maker and checker must record a reason to pass it),
   >= 25 Medium, otherwise Low. The Administrator can switch rules on or off
   and change weights and thresholds. The watchlist holds test names only.  */
const COMPLIANCE_RULES = [
  { id:'amount',    label:'Large transaction',            weight:30, enabled:true, param:100000,
    help:'USD-equivalent amount above the threshold.' },
  { id:'country',   label:'High-risk jurisdiction',       weight:60, enabled:true,
    param:['Iran','North Korea','Syria','Myanmar','Afghanistan','Cuba'],
    help:'Beneficiary, bank or remitter country on the list.' },
  { id:'sanctions', label:'Watchlist name match',         weight:100, enabled:true,
    param:['Test Sanctioned Entity','Blocked Trading LLC','Kim Il Exports'],
    help:'Counterparty name matches a watchlist entry (test names only).' },
  { id:'newbene',   label:'New beneficiary',              weight:10, enabled:true,
    help:'First payment to this beneficiary account.' },
  { id:'firsttxn',  label:'First transaction for the SME', weight:10, enabled:true,
    help:'The SME has no completed transaction in this direction.' },
  { id:'capital',   label:'Capital-account purpose code', weight:25, enabled:true,
    help:'Purpose codes S0001–S0099 (investment, loans, deposits).' },
  { id:'docai',     label:'Document AI mismatch',         weight:25, enabled:true,
    help:'Simulated: any uploaded file whose name contains “mismatch”.' },
  { id:'bankctry',  label:'Bank outside beneficiary country', weight:10, enabled:true,
    help:'Beneficiary bank country differs from the beneficiary country.' },
  { id:'deal',      label:'Rate by offline deal',         weight:5,  enabled:true,
    help:'Rate taken from an FX deal reference rather than booked on the platform.' },
];

/* --- test-data profiles ---------------------------------------------------------
   Ready-to-transact businesses created at seed time and from the Test data
   lab, each with verified accounts, beneficiaries, several accepted bills
   and receipts waiting for disposal — so every flow can be run many times.  */
const TEST_SMES = [
  { key:'COASTALCASH', legalName:'Coastal Cashew Exports Private Limited', tradingName:'Coastal Cashew', constitution:'Private Limited',
    permission:'Export', currencies:['USD','EUR','AED'], city:'Kollam', state:'32', contact:'Maya Menon', industry:'Agri commodities' },
  { key:'PUNEAUTO', legalName:'Pune Auto Components LLP', tradingName:'Pune Auto Components', constitution:'Partnership',
    permission:'Import', currencies:['USD','EUR','JPY'], city:'Pune', state:'27', contact:'Sameer Joshi', industry:'Automotive parts' },
  { key:'MYSOREMACH', legalName:'Mysore Machine Works Private Limited', tradingName:'Mysore Machine Works', constitution:'Private Limited',
    permission:'Both', currencies:['USD','EUR','GBP'], city:'Mysuru', state:'29', contact:'Pradeep Hegde', industry:'Machine tools' },
  { key:'KERALACOIR', legalName:'Kerala Coir Craft', tradingName:'Kerala Coir Craft', constitution:'Proprietorship',
    permission:'Export', currencies:['USD','GBP','AUD'], city:'Alappuzha', state:'32', contact:'Joseph Mathew', industry:'Home furnishings' },
  { key:'HYDPHARMA', legalName:'Hyderabad Pharma Inputs Limited', tradingName:'Hyderabad Pharma Inputs', constitution:'Public Limited',
    permission:'Both', currencies:['USD','EUR','CHF'], city:'Hyderabad', state:'36', contact:'Lakshmi Rao', industry:'Pharmaceutical intermediates' },
  { key:'DELHIDECOR', legalName:'Delhi Home Decor Private Limited', tradingName:'Delhi Home Decor', constitution:'Private Limited',
    permission:'Both', currencies:['USD','GBP','AED','SGD'], city:'New Delhi', state:'07', contact:'Ritu Arora', industry:'Handicrafts and decor' },
];

/* --- document policy ---------------------------------------------------------
   Source: the workbook's Document Policy sheet. Documents attach to the product.
   rule:
     required   always required
     optional   collected if available
     goods      required when the purpose code is for import of goods (GOODS_CODES)
     threshold  required above `threshold` in INR equivalent, optional below
     knockoff   required when a disposal knocks off bills, optional for an advance
   Form 145 and Form 146 are the Income-tax Act 2025 successors to Form 15CA
   and Form 15CB. The Administrator can change any rule.                     */
const GOODS_CODES = ['S0101','S0102','S0103','S0104','S0109','S1505','S0501'];

const DOC_POLICY = [
  { product:'AIR',   id:'proforma',  name:'Proforma Invoice',            rule:'required' },

  { product:'DIR',   id:'transport', name:'Transport Document',          rule:'required' },
  { product:'DIR',   id:'invoice',   name:'Commercial Invoice',          rule:'required' },
  { product:'DIR',   id:'boe',       name:'Bill of Entry',               rule:'required' },

  { product:'OTT',   id:'invoice',   name:'Invoice',                     rule:'required' },
  { product:'OTT',   id:'transport', name:'Transport Document',          rule:'goods' },
  { product:'OTT',   id:'form145',   name:'Form 145 (formerly Form 15CA)', rule:'required' },
  { product:'OTT',   id:'form146',   name:'Form 146 (formerly Form 15CB — CA certificate)', rule:'threshold', threshold:500000 },

  { product:'LC',    id:'lccopy',    name:'Letter of Credit copy',       rule:'required' },
  { product:'LC',    id:'invoice',   name:'Commercial Invoice',          rule:'required' },
  { product:'LC',    id:'transport', name:'Transport Document',          rule:'required' },
  { product:'LC',    id:'boe',       name:'Bill of Entry',               rule:'optional' },

  { product:'TRADE', id:'dil',       name:'Disposal Instruction Letter', rule:'required' },
  { product:'TRADE', id:'expinv',    name:'Commercial Export Invoice',   rule:'knockoff' },
  { product:'TRADE', id:'sb',        name:'Shipping Bill',               rule:'knockoff' },
];

/* --- onboarding document checklist ----------------------------------------- */
const ONBOARD_DOCS = [
  { id:'coi',   name:'Certificate of incorporation / registration', required:true },
  { id:'pan',   name:'PAN card',                                    required:true },
  { id:'gst',   name:'GST registration certificate',                required:true },
  { id:'iec',   name:'IEC certificate',                             required:true },
  { id:'addr',  name:'Registered address proof',                    required:true },
  { id:'board', name:'Board resolution / authority letter',         required:false },
  { id:'fin',   name:'Latest audited financials',                   required:false },
];

const CHARGE_CATEGORIES = [
  { id:'txn',    name:'Transaction handling fee' },
  { id:'swift',  name:'SWIFT charge' },
  { id:'nostro', name:'Correspondent bank charge' },
  { id:'doc',    name:'Document handling fee' },
];

/* --- capabilities and roles -----------------------------------------------
   One row per action, one column per role (the TMP portal's ADM-02 pattern).
   The API enforces these; the interface only hides what a role cannot do.
   A capability marked *segregated* is withheld deliberately so that whoever
   prepares work is not whoever approves or releases it.

   Onboarding:   applicant (or Sales / Maker offline) -> AD2 Maker reviews and
                 prices -> AD2 Compliance approves.
   Transactions: SME (or AD2 on its behalf) -> AD2 Maker verifies -> AD2
                 Checker or Operations authorises -> AD2 Operations releases
                 or processes. Each stage must be a different person.
   The branch maker is common to onboarding and transactions; the checking
   is split — Compliance approves customers, Trade (Checker / Operations)
   approves money (review of 24 Sep).                                       */
const CAPABILITIES = [
  { id:'onboard.apply',        group:'Onboarding',     label:'Submit an onboarding application and answer queries' },
  { id:'onboard.createOffline',group:'Onboarding',     label:'Capture an application for an SME (offline)' },
  { id:'onboard.review',       group:'Onboarding',     label:'Review an application and prepare pricing' },
  { id:'onboard.query',        group:'Onboarding',     label:'Raise a clarification on an application' },
  { id:'onboard.approve',      group:'Onboarding',     label:'Approve, return or reject an application' },

  { id:'outward.create',       group:'Outward',        label:'Create and submit an outward request' },
  { id:'outward.viewOwn',      group:'Outward',        label:'View its own outward requests' },
  { id:'outward.viewAll',      group:'Outward',        label:'View outward requests across all SMEs' },
  { id:'outward.verify',       group:'Outward',        label:'Verify an outward request (maker)' },
  { id:'outward.query',        group:'Outward',        label:'Raise a query on an outward request' },
  { id:'outward.approve',      group:'Outward',        label:'Authorise an outward request (checker)' },
  { id:'outward.complete',     group:'Outward',        label:'Execute an authorised payment' },
  { id:'outward.reject',       group:'Outward',        label:'Reject an outward request' },

  { id:'inward.viewOwn',       group:'Inward',         label:'View its own inward receipts' },
  { id:'inward.viewAll',       group:'Inward',         label:'View inward receipts across all SMEs' },
  { id:'inward.record',        group:'Inward',         label:'Record an incoming remittance, or confirm one the SME reported' },
  { id:'inward.dispose',       group:'Inward',         label:'Report an inward remittance and submit a disposal instruction' },
  { id:'inward.verifyDisposal',group:'Inward',         label:'Verify a disposal instruction (maker)' },
  { id:'inward.approveDisposal',group:'Inward',        label:'Authorise a disposal instruction (checker)' },
  { id:'inward.processDisposal',group:'Inward',        label:'Process an authorised disposal and issue the FIRC' },

  { id:'bills.lodge',          group:'Bill lodgement', label:'Lodge an import or export bill' },
  { id:'bills.viewAll',        group:'Bill lodgement', label:'View bills across all SMEs' },
  { id:'bills.accept',         group:'Bill lodgement', label:'Accept or query a lodged bill' },

  { id:'recon.propose',        group:'Reconciliation', label:'Propose a knock-off allocation' },
  { id:'recon.confirm',        group:'Reconciliation', label:'Confirm a knock-off allocation' },
  { id:'recon.reverse',        group:'Reconciliation', label:'Reverse a confirmed allocation' },

  { id:'txn.resolveQuery',     group:'Queries',        label:'Answer a query on the customer’s behalf, with the documents it sent' },

  { id:'masters.beneficiary',  group:'Masters',        label:'Maintain the beneficiary and account masters' },
  { id:'assist.transact',      group:'Assisted',       label:'Transact on behalf of an SME' },
  { id:'fx.dealRef',           group:'Assisted',       label:'Apply an FX deal reference negotiated with the treasury desk' },
  { id:'reports.view',         group:'Reports',        label:'View and export reports' },
  { id:'lab.use',              group:'Test data',      label:'Generate test businesses, bills, receipts and requests' },
  { id:'test.master',          group:'Test data',      label:'Open the platform as any user, to run a journey end to end' },

  { id:'treasury.view',        group:'Treasury',       label:'See the treasury book: positions, cover, deals, P&L and the integration log' },
  { id:'treasury.deal',        group:'Treasury',       label:'Propose rates, enter and allocate bank cover, cross positions and issue FX deal references' },
  { id:'treasury.approve',     group:'Treasury',       label:'Approve or reject anything a treasury maker submits: card rates, settlements, uploads, limits, held deals, amendments and configuration' },
  { id:'tmp.rates',            group:'Treasury',       label:'Import base rates and propose card rates on the rate desk' },
  { id:'tmp.settle',           group:'Treasury',       label:'Enter forward-cover and credit-line settlements (sent to a checker)' },
  { id:'tmp.liquidity',        group:'Treasury',       label:'Upload Nostro statements and refresh liquidity feeds' },
  { id:'tmp.limits',           group:'Treasury',       label:'Request changes to customer credit limits' },
  { id:'tmp.amend',            group:'Treasury',       label:'Unwind positions when a source transaction is amended or reversed' },
  { id:'tmp.exceptions',       group:'Treasury',       label:'Investigate, assign and resolve treasury exceptions' },
  { id:'tmp.cancel',           group:'Treasury',       label:'Cancel a position’s residual and release its cover' },
  { id:'tmp.bulk.book',        group:'Treasury',       label:'Record the booking detail against a regional bulk request' },
  { id:'tmp.branch',           group:'Branch',         label:'Work a branch in the Treasury Management Portal' },
  { id:'tmp.quote',            group:'Branch',         label:'Take an FX rate and book a position' },
  { id:'tmp.link',             group:'Branch',         label:'Knock off FX Plus transactions against a position' },
  { id:'tmp.cutoff',           group:'Branch',         label:'Keep, requote or escalate a position before cut-off, and acknowledge reminders' },
  { id:'tmp.offline',          group:'Branch',         label:'Capture a deal taken while the portal was unreachable' },
  { id:'tmp.agent',            group:'Branch',         label:'Quote and book as an agent or partner, for the servicing branch' },
  { id:'tmp.bulk.request',     group:'Operations',     label:'Raise a regional bulk currency booking request' },
  { id:'tmp.finance',          group:'Operations',     label:'Map card settlements and reconcile issuer settlements' },
  { id:'tmp.admin',            group:'Administration', label:'Administer the Treasury Management Portal: users, masters, org hierarchy, integrations' },

  { id:'admin.masters',        group:'Administration', label:'Maintain purpose codes, document policy and compliance rules' },
  { id:'admin.users',          group:'Administration', label:'Manage users and roles' },
  { id:'admin.settings',       group:'Administration', label:'Change platform settings' },
];

const ROLES = [
  { id:'SME Applicant', portal:'SME', order:1,
    summary:'A business partway through onboarding. It can submit its application, track it and answer AD2 queries, and has no transaction access until AD2 approves it.',
    can:['onboard.apply'] },

  { id:'SME User', portal:'SME', order:2,
    summary:'The day-to-day user at an approved SME. Raises outward payments, reports and disposes of inward receipts, lodges bills and proposes knock-offs — within the service permission and currencies AD2 approved, and only for its own SME. It books the live rate; it never sees AD2’s margin.',
    can:['outward.create','outward.viewOwn','inward.viewOwn','inward.dispose','bills.lodge',
         'recon.propose','masters.beneficiary','reports.view','lab.use'],
    segregated:['outward.approve','recon.confirm','fx.dealRef'],
    note:'An SME user submits without a second SME approver. SME-side maker-checker is a later addition. The customer may quote an FX deal reference the treasury desk issued it — the rate comes from the deal; only AD2 enters a phone deal or a rate.' },

  { id:'AD2 Sales', portal:'AD2', order:3,
    summary:'Branch relationship manager. Captures offline applications and transacts on behalf of the SMEs it looks after — bookings, disposals, bill lodgement — which then go to a maker to verify.',
    can:['onboard.createOffline','outward.viewAll','inward.viewAll','bills.viewAll','bills.lodge','recon.propose',
         'assist.transact','fx.dealRef','masters.beneficiary','reports.view','lab.use'],
    segregated:['onboard.review','onboard.approve','outward.verify','outward.approve','outward.complete',
                'inward.verifyDisposal','inward.approveDisposal','inward.processDisposal','recon.confirm'],
    note:'Sales → maker → checker: whatever this role raises is verified and authorised by other people.' },

  { id:'AD2 Maker', portal:'AD2', order:4,
    summary:'The branch maker. Onboards customers (captures and prices applications), transacts on their behalf, verifies what customers submit, and answers a query with the documents a customer hands in — but never approves a customer or authorises money.',
    can:['onboard.createOffline','onboard.review','onboard.query','outward.viewAll','outward.verify','outward.query',
         'inward.viewAll','inward.verifyDisposal','bills.viewAll','bills.lodge','recon.propose','assist.transact','fx.dealRef',
         'txn.resolveQuery','masters.beneficiary','reports.view','lab.use'],
    segregated:['onboard.approve','outward.approve','outward.reject','outward.complete','inward.approveDisposal',
                'inward.processDisposal','bills.accept','recon.confirm'],
    note:'One maker login serves the branch for both onboarding and transactions. The checking is split: Compliance approves customers; Checker or Operations approves money.' },

  { id:'AD2 Checker', portal:'AD2', order:5,
    summary:'Trade checker — the second pair of eyes on money. Authorises what a maker verified, accepts lodged bills and confirms knock-offs. Does not approve customers (that is Compliance) and cannot originate or verify the work it approves.',
    can:['outward.viewAll','outward.approve','outward.query','outward.reject',
         'inward.viewAll','inward.approveDisposal','bills.viewAll','bills.accept','recon.confirm','txn.resolveQuery','reports.view','lab.use'],
    segregated:['onboard.createOffline','onboard.review','outward.create','outward.verify','outward.complete',
                'inward.verifyDisposal','inward.processDisposal','bills.lodge','recon.propose'] },

  { id:'AD2 Compliance', portal:'AD2', order:6,
    summary:'Onboarding checker. Approves, returns or rejects the applications a maker has reviewed and priced, and raises clarifications with the applicant. Sees transactions for oversight but holds no transaction authority.',
    can:['onboard.approve','onboard.query','outward.viewAll','inward.viewAll','bills.viewAll','reports.view','lab.use'],
    segregated:['onboard.createOffline','onboard.review','outward.approve','outward.complete','inward.approveDisposal',
                'inward.processDisposal','bills.accept','recon.confirm'],
    note:'Kept apart from transaction approval, per the 24 Sep review: the person who approves a customer is not the person who approves its money.' },

  { id:'AD2 Operations', portal:'AD2', order:7,
    summary:'Trade operations. Records and confirms incoming remittances, authorises verified requests, accepts bills and confirms knock-offs, then releases payments over SWIFT and processes disposals with the FIRC. Four-eyes still applies: whoever authorises a request cannot also release it.',
    can:['outward.viewAll','outward.approve','outward.complete','outward.query','outward.reject','inward.viewAll','inward.record',
         'inward.approveDisposal','inward.processDisposal','bills.viewAll','bills.accept','recon.confirm','recon.reverse',
         'assist.transact','fx.dealRef','txn.resolveQuery','masters.beneficiary','reports.view','lab.use'],
    segregated:['onboard.approve','onboard.review','outward.verify','inward.verifyDisposal'],
    note:'Two operations users (Farhan, Neha) let one authorise and the other release the same request.' },

  { id:'AD2 Treasury Dealer', portal:'TMP', workspace:'treasury', order:8,
    summary:'Treasury maker, in the Treasury Management Portal. Imports base rates and proposes card rates, sees every trade booking and branch quote as a position, buys bank cover, allocates it or crosses opposite positions, enters forward settlements, uploads Nostro statements and unwinds amended bills. Everything that moves money goes to a treasury checker.',
    can:['treasury.view','treasury.deal','tmp.rates','tmp.settle','tmp.liquidity','tmp.limits','tmp.amend','tmp.exceptions','tmp.cancel',
         'tmp.bulk.book','reports.view'],
    segregated:['treasury.approve','outward.create','outward.verify','outward.approve','outward.complete','inward.dispose',
                'inward.approveDisposal','inward.processDisposal','fx.dealRef'],
    note:'The dealer issues a deal reference; the branch applies it to the customer’s request. Neither can do the other’s step.' },

  { id:'AD2 Treasury Checker', portal:'TMP', workspace:'treasury', order:9,
    summary:'The second pair of eyes in treasury. Works the approvals inbox — card rates, forward settlements, Nostro replacements, bulk bookings, limit changes, held deals, amendments and configuration — never its own entry, and oversees the book, exceptions and P&L.',
    can:['treasury.view','treasury.approve','tmp.exceptions','tmp.cancel','reports.view'],
    segregated:['treasury.deal','tmp.rates','tmp.settle','outward.approve','inward.approveDisposal'] },

  { id:'AD2 Treasury Viewer', portal:'TMP', workspace:'treasury', readOnly:true, order:9.2,
    summary:'Treasury / management user. Reads every treasury screen, report and P&L and exports them; sees no action controls at all.',
    can:['treasury.view','reports.view'],
    segregated:['treasury.deal','treasury.approve'] },

  { id:'AD2 Branch Inputter', portal:'TMP', workspace:'branch', order:9.4,
    summary:'Branch counter in the Treasury Management Portal. Quotes and books FX rates for walk-in, card and corporate customers, knocks off FX Plus bills against its positions, and clears residuals before cut-off — for its own branch only.',
    can:['tmp.branch','tmp.quote','tmp.link','tmp.cutoff','tmp.cancel','tmp.offline','reports.view'],
    segregated:['treasury.view','treasury.deal','treasury.approve'] },

  { id:'Agent Partner', portal:'TMP', workspace:'branch', order:9.5,
    summary:'An agent or partner quoting on the servicing branch’s rate: fixed channel and branch, own deals only, and cancellation routed through the branch.',
    can:['tmp.agent','tmp.quote'],
    segregated:['tmp.cancel','tmp.link'] },

  { id:'AD2 Regional Bulk', portal:'TMP', workspace:'ops', order:9.6,
    summary:'Regional bulk team. Raises currency booking requests for its region and tracks them to completion; never enters treasury.',
    can:['tmp.bulk.request','reports.view'] },

  { id:'AD2 Finance', portal:'TMP', workspace:'ops', order:9.7,
    summary:'Finance and accounts. Maps card settlements to invoices, reconciles issuer settlements and uploads Nostro statements; reads liquidity and MIS. Takes no positions and allocates no cover.',
    can:['tmp.finance','tmp.liquidity','treasury.view','reports.view'],
    segregated:['treasury.deal','treasury.approve'] },

  { id:'AD2 Administrator', portal:'AD2', order:10,
    summary:'Maintains the platform rather than the book: purpose codes, document policy, users, roles and settings. Deliberately holds no transaction authority.',
    can:['admin.masters','admin.users','admin.settings','outward.viewAll','inward.viewAll',
         'bills.viewAll','reports.view','lab.use','treasury.view','tmp.admin'],
    segregated:['onboard.approve','outward.approve','recon.confirm','inward.dispose'],
    note:'Kept out of the transaction path on purpose: whoever configures the controls should not also be able to transact through them.' },

  { id:'Master Tester', portal:'TEST', order:11,
    summary:'One sign-in for testing and demos. Sees the whole platform and opens it as any customer or AD2 user in one click, so a journey runs end to end without signing in and out. Holds no authority of its own: each step is taken as, and recorded against, the user it opens, so four-eyes still applies. Every switch is written to the audit log.',
    can:['test.master','outward.viewAll','inward.viewAll','bills.viewAll','reports.view','treasury.view'],
    note:'Not assignable to a user. Switched off with the test tools in Platform settings.' },
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
    email:'kavita.meridiantextiles@mailinator.com', mobile:'+91 98204 11562',
    industry:'Textiles and apparel', description:'Cotton and blended fabric exporter, supplying EU and UK retail.',
    importVolume:'USD 1,200,000', exportVolume:'USD 2,800,000', countries:['United Kingdom','Germany','Italy','China'],
    requestedCurrencies:['USD','EUR','GBP'], service:'Both',
    signatories:[{ name:'Kavita Raghunathan', designation:'Director — Finance', email:'kavita.meridiantextiles@mailinator.com', mobile:'+91 98204 11562', authority:'Singly', limit:500000 },
                 { name:'Arjun Raghunathan', designation:'Managing Director', email:'arjun.meridiantextiles@mailinator.com', mobile:'+91 98204 11570', authority:'Singly', limit:null },
                 { name:'Neha Kulkarni', designation:'Finance Manager', email:'neha.meridiantextiles@mailinator.com', mobile:'+91 98204 11588', authority:'Jointly', limit:250000 }],
    source:'Digital', createdBy:'SME Applicant', status:'Approved',
    submittedAt:'2026-07-02T09:20:00', approvedAt:'2026-07-09T15:42:00',
    config:{
      permission:'Both', currencies:['USD','EUR','GBP'],
      margins:{ USD:50, EUR:60, GBP:68 }, marginBasis:'paise',
      charges:[
        { category:'txn',   name:'Transaction handling fee', basis:'Fixed', value:500, currency:'INR', frequency:'Per transaction' },
        { category:'swift', name:'SWIFT charge',             basis:'Fixed', value:750, currency:'INR', frequency:'Per transaction',
          byCurrency:{ USD:1500, EUR:1800, GBP:1700 } },
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
    email:'devansh.arcadiacomponents@mailinator.com', mobile:'+91 99745 20388',
    industry:'Electronic components', description:'Imports passive components and connectors for domestic assembly.',
    importVolume:'USD 2,200,000', countries:['China','Singapore','Taiwan'], requestedCurrencies:['USD','SGD'], service:'Import',
    signatories:[{ name:'Devansh Mehta', designation:'Managing Partner', email:'devansh.arcadiacomponents@mailinator.com', mobile:'+91 99745 20388', authority:'Singly', limit:null },
                 { name:'Pooja Shah', designation:'Partner', email:'pooja.arcadiacomponents@mailinator.com', mobile:'+91 99745 20391', authority:'Jointly', limit:200000 }],
    source:'Offline', createdBy:'AD2 Maker (R. Iyer)', status:'Approved',
    submittedAt:'2026-08-01T11:05:00', approvedAt:'2026-08-06T10:12:00',
    config:{
      permission:'Import', currencies:['USD','SGD'],
      margins:{ USD:55, SGD:61 }, marginBasis:'paise',
      charges:[
        { category:'txn',   name:'Transaction handling fee', basis:'Fixed', value:450, currency:'INR', frequency:'Per transaction' },
        { category:'doc',   name:'Document handling fee',    basis:'Fixed', value:300, currency:'INR', frequency:'Per document set' },
        { category:'swift', name:'SWIFT charge',             basis:'Fixed', value:750, currency:'INR', frequency:'Per transaction',
          byCurrency:{ USD:1500, SGD:1400 } },
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
    email:'suresh.nilgirispice@mailinator.com', mobile:'+91 94430 71129',
    industry:'Agricultural commodities', description:'Pepper, cardamom and clove exports to the Gulf and Europe.',
    exportVolume:'USD 900,000', countries:['United Arab Emirates','Saudi Arabia','Netherlands'], requestedCurrencies:['USD','AED'], service:'Export',
    signatories:[{ name:'Suresh Palaniappan', designation:'Proprietor', email:'suresh.nilgirispice@mailinator.com', mobile:'+91 94430 71129', authority:'Singly', limit:null }],
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
    email:'hk.hktrading@mailinator.com', mobile:'+91 98250 66214',
    industry:'Chemicals and dyes', description:'Dye intermediates, importing from China and Korea.',
    importVolume:'USD 1,400,000', countries:['China','South Korea'], requestedCurrencies:['USD'], service:'Import',
    signatories:[{ name:'Harikrishna Patel', designation:'Karta', email:'hk.hktrading@mailinator.com', mobile:'+91 98250 66214', authority:'Singly', limit:null }],
    source:'Digital', createdBy:'SME Applicant', status:'Clarification Required',
    submittedAt:'2026-09-15T10:02:00', approvedAt:null, config:null,
    query:{ question:'IEC is mandatory for regular importers. Please provide your Importer Exporter Code.',
            raisedBy:'AD2 Maker (Rohit Iyer)', raisedAt:'2026-09-16T11:20:00', response:null,
            docs:[{ id:'iec', name:'IEC certificate' }, { id:'other1', name:'Import licence for dye intermediates' }] }
  },
  {
    id:'SME-1005', legalName:'Ishani Consulting (Individual)', tradingName:'Ishani Consulting',
    constitution:'Individual', incorporationDate:'2023-01-09', regNumber:'IND-IC-8830',
    country:'India', address:'B-303 Lake View, Bengaluru 560103',
    domainId:'ISHANICONS', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AKPPI8830Q', gstin:'29AKPPI8830Q1ZD', iec:'1122556677',
    contactName:'Ishani Bhattacharya', designation:'Proprietor',
    email:'ishani.ishaniconsulting@mailinator.com', mobile:'+91 90080 34417',
    industry:'Professional services', description:'Engineering design consultancy billing overseas principals.',
    exportVolume:'USD 300,000', countries:['Germany','United States'], requestedCurrencies:['USD','EUR'], service:'Export',
    signatories:[{ name:'Ishani Bhattacharya', designation:'Proprietor', email:'ishani.ishaniconsulting@mailinator.com', mobile:'+91 90080 34417', authority:'Singly', limit:null }],
    source:'Digital', createdBy:'SME Applicant', status:'Pending Approval',
    submittedAt:'2026-09-18T14:25:00', approvedAt:null, config:null,
    /* prepared by the maker and waiting for a checker */
    pendingConfig:{
      permission:'Export', currencies:['USD','EUR'], margins:{ USD:48 }, marginBasis:'paise',
      charges:[{ category:'txn', name:'Transaction handling fee', basis:'Fixed', value:400, currency:'INR', frequency:'Per transaction' }],
      effectiveDate:'2026-09-25', remarks:'Services exporter. USD base margin, EUR derived.' },
    reviewedBy:{ key:'AD2/MAKER', label:'AD2 Maker (Rohit Iyer)', at:'2026-09-19T10:05:00' }
  },
  {
    id:'SME-1006', legalName:'Caldera Metals Limited', tradingName:'Caldera Metals',
    constitution:'Public Limited', incorporationDate:'2009-03-22', regNumber:'L27100GJ2009PLC055120',
    country:'India', address:'Survey 118, Dahej SEZ, Bharuch 392130',
    domainId:'CALDERAMET', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'AABCC5512J', gstin:'24AABCC5512J1ZM', iec:'0909112233',
    contactName:'Ramesh Chandran', designation:'Head of Treasury',
    email:'ramesh.calderametals@mailinator.com', mobile:'+91 99133 88204',
    industry:'Metals and alloys', description:'Aluminium billet importer and semi-finished exporter.',
    importVolume:'USD 5,000,000', exportVolume:'USD 2,500,000', countries:['Australia','Japan','Germany','United Arab Emirates'],
    requestedCurrencies:['USD','EUR','JPY'], service:'Both',
    signatories:[{ name:'Ramesh Chandran', designation:'Head of Treasury', email:'ramesh.calderametals@mailinator.com', mobile:'+91 99133 88204', authority:'Jointly', limit:1000000 },
                 { name:'Leela Varghese', designation:'Chief Financial Officer', email:'leela.calderametals@mailinator.com', mobile:'+91 99133 88219', authority:'Singly', limit:null }],
    source:'Offline', createdBy:'AD2 Maker (R. Iyer)', status:'Submitted',
    submittedAt:'2026-09-20T09:15:00', approvedAt:null, config:null
  },
];


/* --- bank account master (per SME; drives remitter + credit selection) ----
   balance is the simulated ledger balance in the account currency. Outward
   execution debits it and disposal processing credits it.                  */
const BANK_ACCOUNTS = [
  { id:'BA-001', smeId:'SME-1001', holder:'Meridian Textiles Private Limited', bank:'HDFC Bank', accountNumber:'50200041228734', ifsc:'HDFC0000241', branch:'Parel, Mumbai', currency:'INR', type:'Current', verified:true,  verifiedOn:'2026-07-08', primary:true,  balance:185000000 },
  { id:'BA-002', smeId:'SME-1001', holder:'Meridian Textiles Private Limited', bank:'ICICI Bank', accountNumber:'002105500912',   ifsc:'ICIC0000021', branch:'Lower Parel, Mumbai', currency:'INR', type:'Current', verified:true,  verifiedOn:'2026-07-08', primary:false, balance:42000000 },
  { id:'BA-003', smeId:'SME-1001', holder:'Meridian Textiles Private Limited', bank:'HDFC Bank', accountNumber:'50200041228990', ifsc:'HDFC0000241', branch:'Parel, Mumbai', currency:'USD', type:'EEFC',    verified:false, verifiedOn:null,        primary:false, balance:120000 },
  { id:'BA-004', smeId:'SME-1002', holder:'Arcadia Components LLP', bank:'Axis Bank',  accountNumber:'918020044127310', ifsc:'UTIB0000133', branch:'Gandhinagar', currency:'INR', type:'Current', verified:true, verifiedOn:'2026-08-05', primary:true, balance:96000000 },
  { id:'BA-005', smeId:'SME-1002', holder:'Arcadia Components LLP', bank:'Kotak Mahindra Bank', accountNumber:'7845102299', ifsc:'KKBK0002611', branch:'Sector 11, Gandhinagar', currency:'INR', type:'Current', verified:false, verifiedOn:null, primary:false, balance:8500000 },
  { id:'BA-006', smeId:'SME-1003', holder:'Nilgiri Spice Exports', bank:'State Bank of India', accountNumber:'38812044719', ifsc:'SBIN0001440', branch:'Coonoor', currency:'INR', type:'Current', verified:true, verifiedOn:'2026-08-19', primary:true, balance:14500000 },
  { id:'BA-007', smeId:'SME-1003', holder:'Nilgiri Spice Exports', bank:'State Bank of India', accountNumber:'38812044886', ifsc:'SBIN0001440', branch:'Coonoor', currency:'USD', type:'EEFC', verified:true, verifiedOn:'2026-08-19', primary:false, balance:36000 },
  { id:'BA-008', smeId:'SME-1005', holder:'Ishani Consulting', bank:'HDFC Bank', accountNumber:'50100338812204', ifsc:'HDFC0001203', branch:'Whitefield, Bengaluru', currency:'INR', type:'Current', verified:true, verifiedOn:'2026-09-18', primary:true, balance:3200000 },
  { id:'BA-009', smeId:'SME-1006', holder:'Caldera Metals Limited', bank:'Bank of Baroda', accountNumber:'29870200001122', ifsc:'BARB0DAHEJX', branch:'Dahej', currency:'INR', type:'Current', verified:true, verifiedOn:'2026-09-19', primary:true, balance:250000000 },
  { id:'BA-010', smeId:'SME-1004', holder:'Harikrishna Joint Family Trading (HUF)', bank:'Bank of India', accountNumber:'200110110004471', ifsc:'BKID0002001', branch:'Relief Road, Ahmedabad', currency:'INR', type:'Current', verified:false, verifiedOn:null, primary:true, balance:6400000 },
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
  { id:'BEN-008', smeId:'SME-1001', name:'Tianjin Cotton Yarn Co Ltd', country:'China',
    address:'88 Binhai Road, Tianjin 300450', accountNumber:'6013820000451127',
    bank:'Bank of China', bankCountry:'China', swift:'BKCHCNBJ', currency:'USD',
    relationship:'Supplier — cotton yarn', addedBy:'SME User', addedOn:'2026-08-21', lastUsed:null },
];


/* --- bills ------------------------------------------------------------------
   adjusted/outstanding always agree with the confirmed entries in the
   allocation ledger (ALLOCATIONS below).                                   */
const BILLS = [
  { id:'BL-24001', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0141', invoiceDate:'2026-07-18', counterparty:'Halstead Retail Group', counterpartyCountry:'United Kingdom', currency:'GBP', amount:184500, adjusted:184500, outstanding:0,      dueDate:'2026-10-16', orderRef:'PO-HRG-88213', shipmentRef:'SB-2261194', source:'Form fill', review:'Accepted', settlement:'Settled' },
  { id:'BL-24002', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0152', invoiceDate:'2026-08-04', counterparty:'Bergmann Textilhandel GmbH', counterpartyCountry:'Germany', currency:'EUR', amount:226800, adjusted:120000, outstanding:106800, dueDate:'2026-11-02', orderRef:'PO-BTH-4417', shipmentRef:'SB-2274410', source:'SAP API', review:'Accepted', settlement:'Partially Settled' },
  { id:'BL-24003', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0163', invoiceDate:'2026-08-27', counterparty:'Halstead Retail Group', counterpartyCountry:'United Kingdom', currency:'GBP', amount:97200,  adjusted:0,      outstanding:97200,  dueDate:'2026-11-25', orderRef:'PO-HRG-88407', shipmentRef:'SB-2288305', source:'SFTP', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24004', smeId:'SME-1001', type:'Import', invoiceNumber:'SUP-IT-99021', invoiceDate:'2026-09-01', counterparty:'Filatura Ponti S.p.A.', counterpartyCountry:'Italy', currency:'EUR', amount:88400, adjusted:0, outstanding:88400, dueDate:'2026-10-31', orderRef:'MTX-PO-2211', shipmentRef:'BOE-7745120', source:'Form fill', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24005', smeId:'SME-1001', type:'Import', invoiceNumber:'SUP-IT-99044', invoiceDate:'2026-09-12', counterparty:'Filatura Ponti S.p.A.', counterpartyCountry:'Italy', currency:'EUR', amount:64100, adjusted:0, outstanding:64100, dueDate:'2026-11-11', orderRef:'MTX-PO-2240', shipmentRef:'BOE-7751208', source:'CSV upload', review:'Submitted', settlement:'Unsettled' },
  { id:'BL-24006', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5512', invoiceDate:'2026-08-22', counterparty:'Shenzhen Ruiyang Electronics', counterpartyCountry:'China', currency:'USD', amount:142300, adjusted:142300, outstanding:0, dueDate:'2026-10-21', orderRef:'ARC-PO-771', shipmentRef:'BOE-7731088', source:'SAP API', review:'Accepted', settlement:'Settled' },
  { id:'BL-24007', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5528', invoiceDate:'2026-09-09', counterparty:'Ruiyang Precision Pte Ltd', counterpartyCountry:'Singapore', currency:'SGD', amount:98750, adjusted:0, outstanding:98750, dueDate:'2026-11-08', orderRef:'ARC-PO-784', shipmentRef:'BOE-7749221', source:'SAP API', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24008', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5533', invoiceDate:'2026-09-17', counterparty:'Shenzhen Ruiyang Electronics', counterpartyCountry:'China', currency:'USD', amount:76900, adjusted:0, outstanding:76900, dueDate:'2026-11-16', orderRef:'ARC-PO-790', shipmentRef:'', source:'Form fill', review:'Query Raised', settlement:'Unsettled',
    query:{ question:'Bill of Entry reference is missing. Add it and resubmit.', raisedBy:'AD2 Checker (Shalini Nair)', raisedAt:'2026-09-18T12:10:00' } },
  { id:'BL-24009', smeId:'SME-1003', type:'Export', invoiceNumber:'NSE/EX/2026/318', invoiceDate:'2026-08-29', counterparty:'Gulf Spice Trading LLC', counterpartyCountry:'United Arab Emirates', currency:'AED', amount:412000, adjusted:180000, outstanding:232000, dueDate:'2026-11-27', orderRef:'GST-PO-1190', shipmentRef:'SB-2290117', source:'Form fill', review:'Accepted', settlement:'Partially Settled' },
  { id:'BL-24010', smeId:'SME-1003', type:'Export', invoiceNumber:'NSE/EX/2026/324', invoiceDate:'2026-09-11', counterparty:'Aroma Europe BV', counterpartyCountry:'Netherlands', currency:'USD', amount:88600, adjusted:0, outstanding:88600, dueDate:'2026-12-10', orderRef:'AEB-PO-556', shipmentRef:'SB-2298820', source:'CSV upload', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24012', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0171', invoiceDate:'2026-09-08', counterparty:'Halstead Retail Group', counterpartyCountry:'United Kingdom', currency:'GBP', amount:60000, adjusted:0, outstanding:60000, dueDate:'2026-12-07', orderRef:'PO-HRG-88512', shipmentRef:'SB-2294471', source:'Form fill', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24013', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5547', invoiceDate:'2026-09-20', counterparty:'Shenzhen Ruiyang Electronics', counterpartyCountry:'China', currency:'USD', amount:30000, adjusted:0, outstanding:30000, dueDate:'2026-11-19', orderRef:'ARC-PO-796', shipmentRef:'BOE-7760043', source:'Form fill', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24011', smeId:'SME-1003', type:'Export', invoiceNumber:'NSE/EX/2026/331', invoiceDate:'2026-09-19', counterparty:'Gulf Spice Trading LLC', counterpartyCountry:'United Arab Emirates', currency:'AED', amount:156400, adjusted:0, outstanding:156400, dueDate:'2026-12-18', orderRef:'GST-PO-1204', shipmentRef:'SB-2301770', source:'Form fill', review:'Accepted', settlement:'Unsettled' },
  /* Free to use from the start: nothing in flight holds these. */
  { id:'BL-24014', smeId:'SME-1001', type:'Import', invoiceNumber:'SUP-IT-99058', invoiceDate:'2026-09-15', counterparty:'Filatura Ponti S.p.A.', counterpartyCountry:'Italy', currency:'EUR', amount:45000, adjusted:0, outstanding:45000, dueDate:'2026-11-14', orderRef:'MTX-PO-2251', shipmentRef:'BOE-7752210', source:'SAP API', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24015', smeId:'SME-1001', type:'Import', invoiceNumber:'SUP-IT-99071', invoiceDate:'2026-09-19', counterparty:'Filatura Ponti S.p.A.', counterpartyCountry:'Italy', currency:'EUR', amount:32750, adjusted:0, outstanding:32750, dueDate:'2026-11-18', orderRef:'MTX-PO-2263', shipmentRef:'BOE-7753396', source:'SAP API', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24016', smeId:'SME-1001', type:'Import', invoiceNumber:'TCY/2026/4471', invoiceDate:'2026-09-10', counterparty:'Tianjin Cotton Yarn Co Ltd', counterpartyCountry:'China', currency:'USD', amount:26400, adjusted:0, outstanding:26400, dueDate:'2026-11-09', orderRef:'MTX-PO-2238', shipmentRef:'BOE-7750981', source:'Form fill', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24017', smeId:'SME-1001', type:'Export', invoiceNumber:'MTX/EXP/2026/0178', invoiceDate:'2026-09-16', counterparty:'Atlantic Home Stores Inc', counterpartyCountry:'United States', currency:'USD', amount:22000, adjusted:0, outstanding:22000, dueDate:'2026-12-15', orderRef:'AHS-PO-5510', shipmentRef:'SB-2296013', source:'Form fill', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24018', smeId:'SME-1002', type:'Import', invoiceNumber:'ACX-IMP-5552', invoiceDate:'2026-09-18', counterparty:'Shenzhen Ruiyang Electronics', counterpartyCountry:'China', currency:'USD', amount:48000, adjusted:0, outstanding:48000, dueDate:'2026-11-17', orderRef:'ARC-PO-801', shipmentRef:'BOE-7760102', source:'SAP API', review:'Accepted', settlement:'Unsettled' },
  { id:'BL-24019', smeId:'SME-1003', type:'Export', invoiceNumber:'NSE/EX/2026/338', invoiceDate:'2026-09-21', counterparty:'Aroma Europe BV', counterpartyCountry:'Netherlands', currency:'USD', amount:41500, adjusted:0, outstanding:41500, dueDate:'2026-12-20', orderRef:'AEB-PO-3302', shipmentRef:'SB-2297450', source:'Form fill', review:'Submitted', settlement:'Unsettled' },
];

/* --- outward remittances ---------------------------------------------------
   wf records who did each stage. Documents on file are filled in from the
   document policy when the state is seeded.                                */
const OUTWARD = [
  { id:'OR-5101', beneficiaryId:'BEN-005', smeId:'SME-1002', beneficiary:'Shenzhen Ruiyang Electronics', beneficiaryCountry:'China',
    beneficiaryAccount:'6222021001128845', beneficiaryBank:'Bank of China', beneficiaryBankCountry:'China', swift:'BKCHCNBJ',
    currency:'USD', amount:142300, purposeCode:'S0102', remittanceType:'DIR', executionDate:'2026-09-08', debitAccountId:'BA-004',
    referenceNumber:'ARC-REM-0921', status:'Completed', requestDate:'2026-09-05T10:12:00',
    rate:{ mode:'booked', refRate:88.18, margin:55, customerRate:88.73, bookedAt:'2026-09-05T10:30:00', expiresAt:'2026-09-07T10:30:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:450},{name:'Document handling fee',amount:300}],
    allocations:[{billId:'BL-24006', amount:142300}], pendingWith:'—', createdBy:'Devansh Mehta', source:'SME',
    utr:'AD2O26090800117', swiftRef:'MT103-AD2-2609080117',
    wf:{ submitted:{ by:'SME User (Devansh Mehta)', at:'2026-09-05T10:12:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-05T14:40:00' },
         authorised:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-06T10:05:00' }, executed:{ by:'AD2 Operations (Farhan Qureshi)', at:'2026-09-08T09:30:00' } } },
  { id:'OR-5102', beneficiaryId:'BEN-006', smeId:'SME-1002', beneficiary:'Ruiyang Precision Pte Ltd', beneficiaryCountry:'Singapore',
    beneficiaryAccount:'0033-991-4471', beneficiaryBank:'DBS Bank', beneficiaryBankCountry:'Singapore', swift:'DBSSSGSG',
    currency:'SGD', amount:40000, purposeCode:'S0102', remittanceType:'DIR', executionDate:'2026-09-26', debitAccountId:'BA-004',
    referenceNumber:'ARC-REM-0934', status:'Authorised', requestDate:'2026-09-21T09:40:00',
    rate:{ mode:'deal', refRate:65.12, margin:61, customerRate:65.73, bookedAt:null, expiresAt:null, dealRef:'FXD-2026-77412' },
    charges:[{name:'Transaction handling fee',amount:450},{name:'Document handling fee',amount:300}],
    allocations:[{billId:'BL-24007', amount:40000}], pendingWith:'AD2 Operations', createdBy:'Devansh Mehta', source:'SME',
    wf:{ submitted:{ by:'SME User (Devansh Mehta)', at:'2026-09-21T09:40:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-22T11:15:00' },
         authorised:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-23T16:20:00' } } },
  { id:'OR-5103', beneficiaryId:'BEN-001', smeId:'SME-1001', beneficiary:'Filatura Ponti S.p.A.', beneficiaryCountry:'Italy',
    beneficiaryAccount:'IT60X0542811101000000123456', beneficiaryBank:'Intesa Sanpaolo', beneficiaryBankCountry:'Italy', swift:'BCITITMM',
    currency:'EUR', amount:88400, purposeCode:'S0102', remittanceType:'DIR', executionDate:'2026-09-28', debitAccountId:'BA-001',
    referenceNumber:'MTX-REM-1142', status:'Verified', requestDate:'2026-09-22T15:05:00',
    rate:{ mode:'booked', refRate:95.71, margin:60, customerRate:96.31, bookedAt:'2026-09-22T15:20:00', expiresAt:'2026-09-24T15:20:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:500},{name:'SWIFT charge',amount:750}],
    allocations:[{billId:'BL-24004', amount:88400}], pendingWith:'AD2 Checker', createdBy:'Kavita Raghunathan', source:'SME',
    wf:{ submitted:{ by:'SME User (Kavita Raghunathan)', at:'2026-09-22T15:05:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-23T10:30:00' } } },
  { id:'OR-5104', smeId:'SME-1001', beneficiary:'Kavita Raghunathan', beneficiaryCountry:'United Kingdom',
    beneficiaryAccount:'GB29NWBK60161331926819', beneficiaryBank:'NatWest', beneficiaryBankCountry:'United Kingdom', swift:'NWBKGB2L',
    currency:'GBP', amount:4200, purposeCode:'S0301', remittanceType:'OTT', executionDate:'2026-09-29', debitAccountId:'BA-001',
    referenceNumber:'MTX-TRV-0088', status:'Clarification Required', requestDate:'2026-09-20T11:30:00',
    rate:{ mode:'booked', refRate:112.64, margin:68, customerRate:113.32, bookedAt:'2026-09-20T11:28:00', expiresAt:'2026-09-22T11:28:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:500},{name:'SWIFT charge',amount:750}],
    allocations:[], pendingWith:'SME', createdBy:'Kavita Raghunathan', source:'SME',
    wf:{ submitted:{ by:'SME User (Kavita Raghunathan)', at:'2026-09-20T11:30:00' } },
    query:{ question:'The invoice attached is for a hotel booking, not business travel services. Upload the travel agent invoice and confirm travel dates.', raisedBy:'AD2 Maker (Rohit Iyer)', raisedAt:'2026-09-21T09:15:00', response:null } },
  { id:'OR-5105', beneficiaryId:'BEN-002', smeId:'SME-1001', beneficiary:'Northgate Advisory Ltd', beneficiaryCountry:'United Kingdom',
    beneficiaryAccount:'GB82WEST12345698765432', beneficiaryBank:'Barclays', beneficiaryBankCountry:'United Kingdom', swift:'BARCGB22',
    currency:'GBP', amount:15800, purposeCode:'S1006', remittanceType:'OTT', executionDate:'2026-10-02', debitAccountId:'BA-002',
    referenceNumber:'', status:'Draft', requestDate:'2026-09-21T16:45:00',
    rate:{ mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, expiresAt:null, dealRef:null },
    charges:[], allocations:[], pendingWith:'SME', createdBy:'Kavita Raghunathan', source:'SME', docs:{} },
  { id:'OR-5106', beneficiaryId:'BEN-005', smeId:'SME-1002', beneficiary:'Shenzhen Ruiyang Electronics', beneficiaryCountry:'China',
    beneficiaryAccount:'6222021001128845', beneficiaryBank:'Bank of China', beneficiaryBankCountry:'China', swift:'BKCHCNBJ',
    currency:'USD', amount:52000, purposeCode:'S0101', remittanceType:'AIR', executionDate:'2026-09-30', debitAccountId:'BA-004',
    referenceNumber:'ARC-ADV-0012', status:'Submitted', requestDate:'2026-09-23T12:20:00',
    rate:{ mode:'booked', refRate:88.42, margin:55, customerRate:88.97, bookedAt:'2026-09-23T12:15:00', expiresAt:'2026-09-25T12:15:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:450},{name:'Document handling fee',amount:300}],
    allocations:[], pendingWith:'AD2 Maker', createdBy:'Devansh Mehta', source:'SME',
    wf:{ submitted:{ by:'SME User (Devansh Mehta)', at:'2026-09-23T12:20:00' } } },
  { id:'OR-5107', beneficiaryId:'BEN-003', smeId:'SME-1001', beneficiary:'Aegis Freight Services Ltd', beneficiaryCountry:'Singapore',
    beneficiaryAccount:'0011-882-3390', beneficiaryBank:'OCBC Bank', beneficiaryBankCountry:'Singapore', swift:'OCBCSGSG',
    currency:'USD', amount:9400, purposeCode:'S0220', remittanceType:'OTT', executionDate:'2026-09-12', debitAccountId:'BA-001',
    referenceNumber:'MTX-FRT-0451', status:'Rejected', requestDate:'2026-09-09T13:00:00',
    rate:{ mode:'booked', refRate:88.30, margin:50, customerRate:88.80, bookedAt:'2026-09-09T12:50:00', expiresAt:'2026-09-11T12:50:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:500},{name:'SWIFT charge',amount:750}], allocations:[], pendingWith:'—',
    createdBy:'Kavita Raghunathan', source:'SME',
    wf:{ submitted:{ by:'SME User (Kavita Raghunathan)', at:'2026-09-09T13:00:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-10T10:00:00' },
         rejected:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-10T15:30:00' } },
    rejectReason:'Freight invoice does not match the transport document reference. Resubmit with matching documents.' },
  /* An advance paid before shipment: the Bill of Entry (BL-24013) has since
     been lodged, so the payment is waiting to be knocked off against it. */
  { id:'OR-5108', beneficiaryId:'BEN-005', smeId:'SME-1002', beneficiary:'Shenzhen Ruiyang Electronics', beneficiaryCountry:'China',
    beneficiaryAccount:'6222021001128845', beneficiaryBank:'Bank of China', beneficiaryBankCountry:'China', swift:'BKCHCNBJ',
    currency:'USD', amount:30000, purposeCode:'S0101', remittanceType:'AIR', executionDate:'2026-09-12', debitAccountId:'BA-004',
    referenceNumber:'ARC-ADV-0009', status:'Completed', requestDate:'2026-09-10T10:05:00',
    rate:{ mode:'booked', refRate:88.20, margin:55, customerRate:88.75, bookedAt:'2026-09-10T10:00:00', expiresAt:'2026-09-12T10:00:00', dealRef:null },
    charges:[{name:'Transaction handling fee',amount:450},{name:'Document handling fee',amount:300}],
    allocations:[], pendingWith:'—', createdBy:'Devansh Mehta', source:'SME', boeDueDate:'2026-12-11',
    utr:'AD2O26091200116', swiftRef:'MT103-AD2-2609120116',
    wf:{ submitted:{ by:'SME User (Devansh Mehta)', at:'2026-09-10T10:05:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-10T13:20:00' },
         authorised:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-11T11:00:00' }, executed:{ by:'AD2 Operations (Farhan Qureshi)', at:'2026-09-12T09:40:00' } } },
];

/* --- inward remittances ----------------------------------------------------
   Recorded by AD2 Operations when the SWIFT credit arrives. available is the
   amount not yet covered by a disposal instruction.                         */
const INWARD = [
  { id:'IR-3301', smeId:'SME-1001', reference:'SWF-INW-772104', valueDate:'2026-09-03', remitter:'Halstead Retail Group',
    remitterCountry:'United Kingdom', currency:'GBP', amount:184500, available:0, status:'Processed',
    remittanceType:'TRADE', purposeCode:'', remarks:'Full settlement of invoice MTX/EXP/2026/0141', firc:'FIRC-2026-118842' },
  { id:'IR-3302', smeId:'SME-1001', reference:'SWF-INW-773990', valueDate:'2026-09-10', remitter:'Bergmann Textilhandel GmbH',
    remitterCountry:'Germany', currency:'EUR', amount:120000, available:0, status:'Processed',
    remittanceType:'TRADE', purposeCode:'', remarks:'Part payment against MTX/EXP/2026/0152', firc:'FIRC-2026-119017' },
  { id:'IR-3303', smeId:'SME-1001', reference:'SWF-INW-775612', valueDate:'2026-09-18', remitter:'Halstead Retail Group',
    remitterCountry:'United Kingdom', currency:'GBP', amount:97200, available:97200, status:'Awaiting Instruction',
    remittanceType:'TRADE', purposeCode:'', remarks:'', firc:null },
  { id:'IR-3304', smeId:'SME-1003', reference:'SWF-INW-776201', valueDate:'2026-09-19', remitter:'Gulf Spice Trading LLC',
    remitterCountry:'United Arab Emirates', currency:'AED', amount:180000, available:0, status:'Processed',
    remittanceType:'TRADE', purposeCode:'', remarks:'Part settlement NSE/EX/2026/318', firc:'FIRC-2026-119204' },
  { id:'IR-3305', smeId:'SME-1003', reference:'SWF-INW-777845', valueDate:'2026-09-21', remitter:'Aroma Europe BV',
    remitterCountry:'Netherlands', currency:'USD', amount:88600, available:88600, status:'Awaiting Instruction',
    remittanceType:'TRADE', purposeCode:'', remarks:'', firc:null },
  { id:'IR-3306', smeId:'SME-1003', reference:'SWF-INW-778990', valueDate:'2026-09-22', remitter:'Gulf Spice Trading LLC',
    remitterCountry:'United Arab Emirates', currency:'AED', amount:232000, available:112000, status:'Awaiting Instruction',
    remittanceType:'TRADE', purposeCode:'', remarks:'Balance against NSE/EX/2026/318', firc:null },
  { id:'IR-3307', smeId:'SME-1001', reference:'SWF-INW-774420', valueDate:'2026-09-15', remitter:'Halstead Retail Group',
    remitterCountry:'United Kingdom', currency:'GBP', amount:40000, available:0, status:'Processed',
    remittanceType:'TRADE', purposeCode:'', remarks:'Advance against order PO-HRG-88512', firc:'FIRC-2026-119121' },
  { id:'IR-3308', smeId:'SME-1001', reference:'SWF-INW-779012', valueDate:'2026-09-23', remitter:'Bergmann Textilhandel GmbH',
    remitterCountry:'Germany', currency:'EUR', amount:106800, available:106800, status:'Awaiting Instruction',
    remittanceType:'TRADE', purposeCode:'', remarks:'Balance payment against MTX/EXP/2026/0152', firc:null },
  { id:'IR-3309', smeId:'SME-1001', reference:'SWF-INW-779044', valueDate:'2026-09-23', remitter:'Atlantic Home Stores Inc',
    remitterCountry:'United States', currency:'USD', amount:15000, available:15000, status:'Awaiting Instruction',
    remittanceType:'TRADE', purposeCode:'', remarks:'Advance for order AHS-PO-5524 — not yet shipped', firc:null },
  /* Reported by the SME before the credit was confirmed in the nostro. */
  { id:'IR-3310', smeId:'SME-1003', reference:'SWF-INW-779101', valueDate:'2026-09-24', remitter:'Aroma Europe BV',
    remitterCountry:'Netherlands', currency:'USD', amount:41500, available:0, status:'Intimated', pendingWith:'AD2 Operations',
    remittanceType:'TRADE', purposeCode:'', remarks:'Buyer’s MT103 copy attached — against NSE/EX/2026/338', firc:null,
    intimatedBy:{ by:'SME User (Suresh Palaniappan)', key:'NILGIRISPICE/SMEUSER', at:'2026-09-24T08:40:00', verb:'reported' },
    docs:{ swiftcopy:{ filename:'MT103-Aroma-Europe.pdf', size:'96 KB', type:'application/pdf', at:'2026-09-24T08:40:00' } } },
];

/* --- disposal instructions ------------------------------------------------ */
const DISPOSALS = [
  { id:'DI-9000', inwardId:'IR-3304', smeId:'SME-1003', amount:180000, currency:'AED',
    creditAccountId:'BA-006', allocations:[{billId:'BL-24009', amount:180000}],
    rate:{ mode:'booked', refRate:24.05, margin:38, customerRate:23.67, bookedAt:'2026-09-19T11:00:00', dealRef:null },
    purposeCode:'', remittanceType:'TRADE', status:'Processed', submittedAt:'2026-09-19T10:40:00', remarks:'',
    creditInr:4260600, firc:'FIRC-2026-119204', createdBy:'Suresh Palaniappan', source:'SME',
    wf:{ submitted:{ by:'SME User (Suresh Palaniappan)', at:'2026-09-19T10:40:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-19T12:10:00' },
         authorised:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-19T14:00:00' }, processed:{ by:'AD2 Operations (Farhan Qureshi)', at:'2026-09-19T16:30:00' } } },
  { id:'DI-9001', inwardId:'IR-3301', smeId:'SME-1001', amount:184500, currency:'GBP',
    creditAccountId:'BA-001', allocations:[{billId:'BL-24001', amount:184500}],
    rate:{ mode:'booked', refRate:112.40, margin:68, customerRate:111.72, bookedAt:'2026-09-03T11:00:00', dealRef:null },
    purposeCode:'', remittanceType:'TRADE', status:'Processed', submittedAt:'2026-09-03T10:40:00', remarks:'',
    creditInr:20612340, firc:'FIRC-2026-118842', createdBy:'Kavita Raghunathan', source:'SME',
    wf:{ submitted:{ by:'SME User (Kavita Raghunathan)', at:'2026-09-03T10:40:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-03T12:00:00' },
         authorised:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-03T15:10:00' }, processed:{ by:'AD2 Operations (Farhan Qureshi)', at:'2026-09-03T17:45:00' } } },
  { id:'DI-9002', inwardId:'IR-3302', smeId:'SME-1001', amount:120000, currency:'EUR',
    creditAccountId:'BA-001', allocations:[{billId:'BL-24002', amount:120000}],
    rate:{ mode:'deal', refRate:95.60, margin:60, customerRate:95.00, bookedAt:null, dealRef:'FXD-2026-77188' },
    purposeCode:'', remittanceType:'TRADE', status:'Processed', submittedAt:'2026-09-10T14:20:00', remarks:'Rate negotiated with treasury desk.',
    creditInr:11400000, firc:'FIRC-2026-119017', createdBy:'Kavita Raghunathan', source:'SME',
    wf:{ submitted:{ by:'SME User (Kavita Raghunathan)', at:'2026-09-10T14:20:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-10T16:00:00' },
         authorised:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-11T10:30:00' }, processed:{ by:'AD2 Operations (Farhan Qureshi)', at:'2026-09-11T12:15:00' } } },
  { id:'DI-9003', inwardId:'IR-3306', smeId:'SME-1003', amount:120000, currency:'AED',
    creditAccountId:'BA-006', allocations:[{billId:'BL-24009', amount:120000}],
    rate:{ mode:'booked', refRate:24.07, margin:38, customerRate:23.69, bookedAt:'2026-09-23T09:50:00', dealRef:null },
    purposeCode:'', remittanceType:'TRADE', status:'Submitted', submittedAt:'2026-09-23T09:45:00', remarks:'Partial disposal; balance to follow.',
    createdBy:'Suresh Palaniappan', source:'SME', pendingWith:'AD2 Maker',
    wf:{ submitted:{ by:'SME User (Suresh Palaniappan)', at:'2026-09-23T09:45:00' } } },
  /* Credited as an advance before the goods shipped. The FIRC is pending
     knock-off until the SME matches it to export bill BL-24012. */
  { id:'DI-9004', inwardId:'IR-3307', smeId:'SME-1001', amount:40000, currency:'GBP', option:'advance',
    creditAccountId:'BA-001', allocations:[], unallocated:40000,
    rate:{ mode:'booked', refRate:112.50, margin:68, customerRate:111.82, bookedAt:'2026-09-15T11:00:00', dealRef:null },
    purposeCode:'TRADE', remittanceType:'TRADE', status:'Processed', submittedAt:'2026-09-15T10:30:00', remarks:'Advance — shipment due end of September.',
    creditInr:4472800, firc:'FIRC-2026-119121', createdBy:'Kavita Raghunathan', source:'SME', pendingWith:'—',
    wf:{ submitted:{ by:'SME User (Kavita Raghunathan)', at:'2026-09-15T10:30:00' }, verified:{ by:'AD2 Maker (Rohit Iyer)', at:'2026-09-15T12:00:00' },
         authorised:{ by:'AD2 Checker (Shalini Nair)', at:'2026-09-15T14:20:00' }, processed:{ by:'AD2 Operations (Farhan Qureshi)', at:'2026-09-15T16:05:00' } } },
];

/* --- allocation ledger -------------------------------------------------------
   Every application of a remittance to a bill. Outward payments and disposal
   instructions write Confirmed entries when they settle; a knock-off proposal
   is Proposed until a checker confirms it.                                  */
const ALLOCATIONS = [
  { id:'AL-0001', smeId:'SME-1002', side:'Import', billId:'BL-24006', remKind:'outward', remId:'OR-5101', ref:'AD2O26090800117', amount:142300, currency:'USD', source:'Outward payment', status:'Confirmed', at:'2026-09-08T09:30:00' },
  { id:'AL-0002', smeId:'SME-1003', side:'Export', billId:'BL-24009', remKind:'disposal', remId:'DI-9000', inwardId:'IR-3304', disposalId:'DI-9000', ref:'FIRC-2026-119204', amount:180000, currency:'AED', source:'Disposal instruction', status:'Confirmed', at:'2026-09-19T16:30:00' },
  { id:'AL-0003', smeId:'SME-1001', side:'Export', billId:'BL-24001', remKind:'disposal', remId:'DI-9001', inwardId:'IR-3301', disposalId:'DI-9001', ref:'FIRC-2026-118842', amount:184500, currency:'GBP', source:'Disposal instruction', status:'Confirmed', at:'2026-09-03T17:45:00' },
  { id:'AL-0004', smeId:'SME-1001', side:'Export', billId:'BL-24002', remKind:'disposal', remId:'DI-9002', inwardId:'IR-3302', disposalId:'DI-9002', ref:'FIRC-2026-119017', amount:120000, currency:'EUR', source:'Disposal instruction', status:'Confirmed', at:'2026-09-11T12:15:00' },
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
  { id:'AU-1', record:'SME-1001', actor:'AD2 Compliance (Meera Krishnan)', action:'Application approved — Both, USD/EUR/GBP', at:'2026-07-09T15:42:00' },
  { id:'AU-2', record:'SME-1001', actor:'AD2 Maker (Rohit Iyer)',     action:'Pricing prepared — USD 50p, EUR 60p, GBP 68p',    at:'2026-07-09T14:10:00', internal:true },
  { id:'AU-3', record:'OR-5103',  actor:'AD2 Maker (Rohit Iyer)',     action:'Verified — documents, sanctions screening and purpose code checked', at:'2026-09-23T10:30:00' },
  { id:'AU-4', record:'OR-5103',  actor:'SME User (Kavita Raghunathan)', action:'Outward request submitted — 88,400.00 EUR, DIR under S0102', at:'2026-09-22T15:05:00' },
  { id:'AU-5', record:'OR-5104',  actor:'AD2 Maker (Rohit Iyer)',     action:'Clarification requested', at:'2026-09-21T09:15:00' },
  { id:'AU-6', record:'BL-24007', actor:'Integration (SAP API)',      action:'Bill lodged from synchronisation job JOB-7739',   at:'2026-09-09T02:04:00' },
  { id:'AU-7', record:'DI-9003',  actor:'SME User (Suresh Palaniappan)', action:'Partial disposal instruction submitted', at:'2026-09-23T09:45:00' },
  { id:'AU-8', record:'SME-1005', actor:'AD2 Maker (Rohit Iyer)',     action:'Review complete — sent to compliance with Export permission, USD/EUR', at:'2026-09-19T10:05:00' },
  { id:'AU-9', record:'SME-1004', actor:'AD2 Maker (Rohit Iyer)',     action:'Clarification requested: IEC is mandatory for regular importers', at:'2026-09-16T11:20:00' },
];

/* --- sign-in accounts ---------------------------------------------------------
   demo:true accounts sign in with the shared demo passcode. An SME that
   registers through the portal sets its own password instead.             */
const ACCOUNTS = [
  { domainId:'TEST',        loginId:'MASTER',   role:'Master Tester',      smeId:null,       name:'Master Tester',      demo:true },
  { domainId:'MERIDIANTEX', loginId:'SMEUSER',  role:'SME User',           smeId:'SME-1001', name:'Kavita Raghunathan', demo:true },
  { domainId:'ARCADIACOMP', loginId:'SMEUSER',  role:'SME User',           smeId:'SME-1002', name:'Devansh Mehta',      demo:true },
  { domainId:'NILGIRISPICE',loginId:'SMEUSER',  role:'SME User',           smeId:'SME-1003', name:'Suresh Palaniappan', demo:true },
  { domainId:'HKTRADING',   loginId:'APPLICANT',role:'SME Applicant',      smeId:'SME-1004', name:'Harikrishna Patel',  demo:true },
  { domainId:'ISHANICONS',  loginId:'APPLICANT',role:'SME Applicant',      smeId:'SME-1005', name:'Ishani Bhattacharya',demo:true },
  { domainId:'AD2',         loginId:'SALES',    role:'AD2 Sales',          smeId:null,       name:'Karan Malhotra',     demo:true },
  { domainId:'AD2',         loginId:'MAKER',    role:'AD2 Maker',          smeId:null,       name:'Rohit Iyer',         demo:true },
  { domainId:'AD2',         loginId:'MAKER2',   role:'AD2 Maker',          smeId:null,       name:'Priya Menon',        demo:true },
  { domainId:'AD2',         loginId:'CHECKER',  role:'AD2 Checker',        smeId:null,       name:'Shalini Nair',       demo:true },
  { domainId:'AD2',         loginId:'CHECKER2', role:'AD2 Checker',        smeId:null,       name:'Vikram Sethi',       demo:true },
  { domainId:'AD2',         loginId:'COMPLIANCE', role:'AD2 Compliance',   smeId:null,       name:'Meera Krishnan',     demo:true },
  { domainId:'AD2',         loginId:'COMPLIANCE2',role:'AD2 Compliance',   smeId:null,       name:'Arvind Rao',         demo:true },
  { domainId:'AD2',         loginId:'OPS',      role:'AD2 Operations',     smeId:null,       name:'Farhan Qureshi',     demo:true },
  { domainId:'AD2',         loginId:'OPS2',     role:'AD2 Operations',     smeId:null,       name:'Neha Kapoor',        demo:true },
  { domainId:'AD2',         loginId:'DEALER',   role:'AD2 Treasury Dealer', smeId:null,      name:'Nikhil Bansal',      demo:true },
  { domainId:'AD2',         loginId:'DEALER2',  role:'AD2 Treasury Dealer', smeId:null,      name:'Sana Sheikh',        demo:true },
  { domainId:'AD2',         loginId:'TCHECKER', role:'AD2 Treasury Checker', smeId:null,     name:'Leela Varghese',     demo:true },
  { domainId:'AD2',         loginId:'TCHECKER2',role:'AD2 Treasury Checker', smeId:null,     name:'Manoj Pillai',       demo:true },
  { domainId:'AD2',         loginId:'TVIEW',    role:'AD2 Treasury Viewer', smeId:null,      name:'Kavya Iyer',         demo:true },
  { domainId:'AD2',         loginId:'BRANCH',   role:'AD2 Branch Inputter', smeId:null,      name:'Anil Kulkarni',      demo:true, branchScope:'BR-MUMFORT' },
  { domainId:'AD2',         loginId:'BRANCH2',  role:'AD2 Branch Inputter', smeId:null,      name:'Deepa Rao',          demo:true, branchScope:'BR-DELCP' },
  { domainId:'AD2',         loginId:'AIRPORT',  role:'AD2 Branch Inputter', smeId:null,      name:'Rahul Nair',         demo:true, branchScope:'BR-MUMT2' },
  { domainId:'AD2',         loginId:'RBULK',    role:'AD2 Regional Bulk',   smeId:null,      name:'Imran Shaikh',       demo:true, branchScope:'WEST' },
  { domainId:'AD2',         loginId:'FINANCE',  role:'AD2 Finance',         smeId:null,      name:'Pooja Shah',         demo:true },
  { domainId:'SUNDARFX',    loginId:'AGENT',    role:'Agent Partner',       smeId:null,      name:'Sundar Raman',       demo:true, branchScope:'BR-PUNE', agentName:'Sundar Forex, Pune' },
  { domainId:'AD2',         loginId:'ADMIN',    role:'AD2 Administrator',  smeId:null,       name:'Anita Desai',        demo:true },
];

/* --- Treasury Management Portal masters ------------------------------------
   Product lines carry their own spreads and cut-offs; the organisation tree
   drives branch scoping and report roll-up; counterparties and correspondent
   banks are where cover is bought and where foreign currency sits.        */
const TMP_PRODUCTS = [
  { code:'REM', name:'Outward remittance', sides:['SELL'], tagging:'Required', cutoff:'16:00', autoCancel:true, quoteMinutes:10,
    spreadPct:0.85, markupPct:0.30, transferPct:0.10, status:'Active', trade:'Outward payments from the trade portal' },
  { code:'FXC', name:'Forex card', sides:['SELL'], tagging:'Required', cutoff:'16:00', autoCancel:true, quoteMinutes:10,
    spreadPct:1.15, markupPct:0.45, transferPct:0.12, status:'Active' },
  { code:'CSH', name:'Cash', sides:['SELL','BUY'], tagging:'Required', cutoff:'15:30', autoCancel:true, quoteMinutes:10,
    spreadPct:1.35, markupPct:0.60, transferPct:0.15, status:'Active' },
  { code:'INW', name:'Inward remittance', sides:['BUY'], tagging:'Excluded', cutoff:null, autoCancel:false, quoteMinutes:10,
    spreadPct:0.85, markupPct:0.30, transferPct:0.10, status:'Active', trade:'Inward disposals credited in INR' },
];
const ORG = [
  { id:'WEST',  name:'West',  type:'Region', parent:null },
  { id:'NORTH', name:'North', type:'Region', parent:null },
  { id:'SOUTH', name:'South', type:'Region', parent:null },
  { id:'CL-MUM', name:'Mumbai & Pune cluster', type:'Cluster', parent:'WEST' },
  { id:'CL-GUJ', name:'Gujarat cluster', type:'Cluster', parent:'WEST' },
  { id:'CL-DEL', name:'Delhi cluster', type:'Cluster', parent:'NORTH' },
  { id:'CL-BLR', name:'Bengaluru & Hyderabad cluster', type:'Cluster', parent:'SOUTH' },
  { id:'CL-TNK', name:'Tamil Nadu & Kerala cluster', type:'Cluster', parent:'SOUTH' },
  { id:'BR-MUMFORT', name:'Mumbai Fort', type:'Branch', parent:'CL-MUM', states:['27'] },
  { id:'BR-MUMT2', name:'Mumbai Airport T2', type:'Airport', parent:'CL-MUM', cutoff:'21:00' },
  { id:'BR-PUNE', name:'Pune Camp', type:'Branch', parent:'CL-MUM' },
  { id:'BR-AHD', name:'Ahmedabad CG Road', type:'Branch', parent:'CL-GUJ', states:['24'] },
  { id:'BR-DELCP', name:'Delhi CP', type:'Branch', parent:'CL-DEL', states:['07','06','09','03','08'] },
  { id:'BR-DELT3', name:'Delhi Airport T3', type:'Airport', parent:'CL-DEL', cutoff:'21:00' },
  { id:'BR-BLRMG', name:'Bengaluru MG Road', type:'Branch', parent:'CL-BLR', states:['29'] },
  { id:'BR-HYD', name:'Hyderabad Banjara Hills', type:'Branch', parent:'CL-BLR', states:['36','37'] },
  { id:'BR-CHENNAI', name:'Chennai Anna Salai', type:'Branch', parent:'CL-TNK', states:['33','34'] },
  { id:'BR-KOCHI', name:'Kochi MG Road', type:'Branch', parent:'CL-TNK', states:['32'] },
];
const COUNTERPARTIES = [
  { name:'HDFC Bank', dealTypes:['Spot','Forward','Swap'], creditLine:'CL-HDFC', settlementAccount:'BK-HDFC-1042', status:'Active' },
  { name:'ICICI Bank', dealTypes:['Spot','Forward'], creditLine:'CL-ICICI', settlementAccount:'BK-ICICI-2051', status:'Active' },
  { name:'State Bank of India', dealTypes:['Forward'], creditLine:null, settlementAccount:'BK-SBI-3068', status:'Active' },
  { name:'Axis Bank', dealTypes:['Spot','Forward'], creditLine:null, settlementAccount:'BK-HDFC-1042', status:'Active' },
  { name:'Kotak Mahindra Bank', dealTypes:['Spot'], creditLine:null, settlementAccount:'BK-HDFC-1042', status:'Active' },
  { name:'Standard Chartered', dealTypes:['Spot','Forward','Swap'], creditLine:null, settlementAccount:'BK-ICICI-2051', status:'Active' },
  { name:'Emirates NBD', dealTypes:['Spot'], creditLine:null, settlementAccount:'BK-ICICI-2051', status:'Active' },
];
const CARD_PREFIXES = [
  { prefix:'4', issuer:'Visa' }, { prefix:'5', issuer:'Mastercard' }, { prefix:'6522', issuer:'ICICI' },
];
const CORRESPONDENTS = {
  USD:'Citibank N.A., New York', EUR:'Deutsche Bank AG, Frankfurt', GBP:'Barclays Bank PLC, London', AED:'Emirates NBD, Dubai',
  SGD:'DBS Bank, Singapore', JPY:'MUFG Bank, Tokyo', CHF:'UBS AG, Zurich', AUD:'ANZ, Melbourne',
};

const SEED = {
  version:SEED_VERSION,
  currencies:CURRENCIES, constitutions:CONSTITUTIONS, purposeCodes:PURPOSE_CODES,
  products:PRODUCTS, docPolicy:DOC_POLICY, goodsCodes:GOODS_CODES,
  inwardPurposes:INWARD_PURPOSES, disposalOptions:DISPOSAL_OPTIONS, complianceRules:COMPLIANCE_RULES, testSmes:TEST_SMES,
  capabilities:CAPABILITIES, roles:ROLES, chargeCategories:CHARGE_CATEGORIES, onboardDocs:ONBOARD_DOCS,
  smes:SMES, accounts:BANK_ACCOUNTS, beneficiaries:BENEFICIARIES, bills:BILLS, outward:OUTWARD, inward:INWARD,
  disposals:DISPOSALS, allocations:ALLOCATIONS, jobs:JOBS, audit:AUDIT, logins:ACCOUNTS,
  notifications:[
    { id:'NT-1', toRole:null, toSmeId:'SME-1004', text:'AD2 needs more information on application SME-1004',
      link:'#/sme/dashboard?for=SME-1004&focus=SME-1004', at:'2026-09-16T11:20:00' } ],
  /* the query alert already sent to HK Trading, so the demo inbox opens with one to follow */
  emails:[
    { id:'EM-1', smeId:'SME-1004', record:'SME-1004', to:['hk.hktrading@mailinator.com'], subject:'AD2 needs more information on application SME-1004',
      link:'#/sme/dashboard?for=SME-1004&focus=SME-1004', sentAt:'2026-09-16T11:20:00',
      docs:['IEC certificate', 'Import licence for dye intermediates'],
      body:'Dear Harikrishna Patel,\n\nAD2 needs more information on application SME-1004:\n\n"IEC is mandatory for regular importers. Please provide your Importer Exporter Code."\n\n' +
           'Documents requested:\n  - IEC certificate\n  - Import licence for dye intermediates\n\nSign in with the link below to answer and upload any documents.\n\nAD2 Trade Services' } ],
  tmpProducts:TMP_PRODUCTS, org:ORG, counterparties:COUNTERPARTIES, cardPrefixes:CARD_PREFIXES, correspondents:CORRESPONDENTS,
  settings:{ autoChecker:false, allowUnlinked:false, testLab:true, marginBand:5, cutoff:'16:00', marketSim:true, maxOpenBookings:5, rateBand:2, agedDays:3,
             steppedThresholdInr:4000000, reminderAfterMin:30, escalateAfterMin:120, approvalSlaMin:120, orgName:'AD2 Trade Services' },
  seq:{ utr:118, firc:119300, inw:779100, audit:100, note:1, notif:1, email:1, ufi:4100, lab:0, pos:100, cov:0, cal:0, fxd:77520, rrv:0, evt:0 },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { SEED };
