// ==UserScript==
// @name         EPO Register Pro
// @namespace    https://tampermonkey.net/
// @version      7.1.06
// @description  EP patent attorney sidebar for the European Patent Register with cross-tab case cache, timeline, and diagnostics
// @updateURL    https://raw.githubusercontent.com/EdLaughton/EP-Register-Pro/nemo/post-merge-followups-3/script.user.js
// @downloadURL  https://raw.githubusercontent.com/EdLaughton/EP-Register-Pro/nemo/post-merge-followups-3/script.user.js
// @match        https://register.epo.org/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      unifiedpatentcourt.org
// @connect      cdnjs.cloudflare.com
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @connect      tessdata.projectnaptha.com
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__epoRegisterPro700) return;
  window.__epoRegisterPro700 = true;

  const VERSION = '7.1.06';
  const CACHE_KEY = 'epoRP_700_cache';
  const OPTIONS_KEY = 'epoRP_700_options';
  const UI_KEY = 'epoRP_700_ui';
  const SESSION_KEY = 'epoRP_700_session';
  const DATE_RE = /(\d{2}\.\d{2}\.\d{4})/;

  const CACHE_SCHEMA = 2;
  const MAX_CASES = 30;
  const MAX_LOGS_PER_APP = 500;
  const FETCH_CONCURRENCY = 2;
  const FETCH_TIMEOUT_MS = 15000;
  const FETCH_RETRIES = 1;
  const PDF_JS_CANDIDATES = [
    {
      id: 'cdnjs',
      lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js',
      worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js',
    },
    {
      id: 'jsdelivr',
      lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.min.js',
      worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js',
    },
    {
      id: 'unpkg',
      lib: 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.min.js',
      worker: 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js',
    },
  ];
  const OCR_TESSERACT_CANDIDATES = [
    { id: 'jsdelivr', lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js' },
    { id: 'unpkg', lib: 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js' },
  ];
  const OCR_MAX_PAGES = 2;
  const OCR_RENDER_SCALE = 2;
  const OCR_RECOGNIZE_OPTIONS = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: () => {},
  };

  const EPO_CODEX_DATA = Object.freeze({
  "byCode": {
    "ABEX": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ABEX",
      "sourceDescription": "Amendments",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "ADWI": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ADWI",
      "sourceDescription": "Application deemed to be withdrawn",
      "internalKey": "LOSS_OF_RIGHTS_R112",
      "procedureFamily": "ALL_EP",
      "phase": "loss_of_rights",
      "classification": "consequence",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Link to underlying missed act using STEP_DESCRIPTION_NAME",
      "parserNote": "Reason strings include missed examination reply, EESR reply, prior-art info, fees, etc."
    },
    "DOBS": {
      "codeNamespace": "procedural_step",
      "sourceCode": "DOBS",
      "sourceDescription": "Communication of observations of proprietor",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "opposition",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "time-limit in record",
      "parserNote": ""
    },
    "EXRE": {
      "codeNamespace": "procedural_step",
      "sourceCode": "EXRE",
      "sourceDescription": "Invitation to indicate the basis for amendments",
      "internalKey": "AMENDMENT_BASIS_INVITATION",
      "procedureFamily": "ALL_EP",
      "phase": "examination",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Good structured marker for Rule 137(4)-type issue."
    },
    "FFEE": {
      "codeNamespace": "procedural_step",
      "sourceCode": "FFEE",
      "sourceDescription": "Payment of national basic fee",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "entry-regional-phase",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "IDOP": {
      "codeNamespace": "procedural_step",
      "sourceCode": "IDOP",
      "sourceDescription": "Interlocutory decision in opposition",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "opposition",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "decision",
      "parserNote": ""
    },
    "IGRA": {
      "codeNamespace": "procedural_step",
      "sourceCode": "IGRA",
      "sourceDescription": "Intention to grant the patent",
      "internalKey": "GRANT_R71_3",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create 4-month candidate from DATE_OF_DISPATCH; prefer actual document despatch/date",
      "parserNote": "Also stores grant fee / print fee / translation dates."
    },
    "IGRE": {
      "codeNamespace": "procedural_step",
      "sourceCode": "IGRE",
      "sourceDescription": "Disapproval of the communication of intention to grant the patent",
      "internalKey": "GRANT_R71_6_DISAPPROVAL",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "incoming-response",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use as applicant action affecting grant branch",
      "parserNote": "May lead to fresh Rule 71(3) or resumed examination."
    },
    "ISAT": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ISAT",
      "sourceDescription": "International searching authority",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "entry-regional-phase",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "LIRE": {
      "codeNamespace": "procedural_step",
      "sourceCode": "LIRE",
      "sourceDescription": "Communication from the examining division in a limitation procedure",
      "internalKey": "LIMITATION_COMMUNICATION",
      "procedureFamily": "LIMITATION_REVOCATION",
      "phase": "limitation",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Limitation-specific communication family."
    },
    "ORAL": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ORAL",
      "sourceDescription": "Oral proceedings",
      "internalKey": "ORAL_PROCEEDINGS_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "examination/opposition/appeal",
      "classification": "hearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Store OP date(s); parse annex separately for Rule 116 final date",
      "parserNote": "The event itself is not enough for final-date logic."
    },
    "OREX": {
      "codeNamespace": "procedural_step",
      "sourceCode": "OREX",
      "sourceDescription": "Communication from the opposition division",
      "internalKey": "OPPOSITION_DIVISION_COMMUNICATION",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Strong structured marker for opposition communications."
    },
    "PART": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PART",
      "sourceDescription": "Invitation to provide information on prior art",
      "internalKey": "PRIOR_ART_INFORMATION_INVITATION",
      "procedureFamily": "ALL_EP",
      "phase": "examination",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + available time-limit/manual review",
      "parserNote": "Often relevant to later ADWI / RFPR routing."
    },
    "PFEE": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PFEE",
      "sourceDescription": "Penalty fee / additional fee",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "time-limit in record",
      "parserNote": ""
    },
    "PMAP": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PMAP",
      "sourceDescription": "Preparation for maintenance of the patent in an amended form",
      "internalKey": "OPPOSITION_R82_BRANCH",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_endgame",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use DATE_OF_DISPATCH as Rule 82 branch anchor and track payment",
      "parserNote": "Maps well to Rule 82(1)/(2) maintenance logic."
    },
    "PREX": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PREX",
      "sourceDescription": "Preliminary examination - PCT II",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "international-examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "PROL": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PROL",
      "sourceDescription": "Language of the procedure",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "all",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "RAEX": {
      "codeNamespace": "procedural_step",
      "sourceCode": "RAEX",
      "sourceDescription": "Request for accelerated examination",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "REJR": {
      "codeNamespace": "procedural_step",
      "sourceCode": "REJR",
      "sourceDescription": "Rejection of the request for revocation of the patent",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "revocation",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "decision",
      "parserNote": ""
    },
    "RFEE": {
      "codeNamespace": "procedural_step",
      "sourceCode": "RFEE",
      "sourceDescription": "Renewal fee payment",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "all",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "RFPR": {
      "codeNamespace": "procedural_step",
      "sourceCode": "RFPR",
      "sourceDescription": "Request for further processing",
      "internalKey": "FURTHER_PROCESSING_REQUEST",
      "procedureFamily": "ALL_EP",
      "phase": "remedial",
      "classification": "remedial",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Attach to missed act using STEP_DESCRIPTION_NAME and record result",
      "parserNote": "Central remedial branch for many missed deadlines."
    },
    "SFEE": {
      "codeNamespace": "procedural_step",
      "sourceCode": "SFEE",
      "sourceDescription": "Fee for a supplementary search",
      "internalKey": "SUPPLEMENTARY_SEARCH_FEE_PAYMENT",
      "procedureFamily": "EURO_PCT",
      "phase": "regional_phase_entry",
      "classification": "payment",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use as Euro-PCT entry/compliance signal, not communication deadline",
      "parserNote": "One of the regional-phase acts."
    },
    "TRAN": {
      "codeNamespace": "procedural_step",
      "sourceCode": "TRAN",
      "sourceDescription": "Translation of the application",
      "internalKey": "EURO_PCT_TRANSLATION_RECEIVED",
      "procedureFamily": "EURO_PCT",
      "phase": "regional_phase_entry",
      "classification": "filing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use as Euro-PCT entry/compliance signal",
      "parserNote": "One of the regional-phase acts."
    },
    "DDIV": {
      "codeNamespace": "procedural_step",
      "sourceCode": "DDIV",
      "sourceDescription": "First communication from the examining division",
      "internalKey": "FIRST_EXAM_COMM_DIVISIONAL_MARKER",
      "procedureFamily": "ALL_EP",
      "phase": "examination",
      "classification": "marker",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use for divisional-window logic and examination chronology",
      "parserNote": "Not necessarily the full text of the communication."
    },
    "WINT": {
      "codeNamespace": "procedural_step",
      "sourceCode": "WINT",
      "sourceDescription": "Withdrawal during international phase - procedure closed",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "entry-regional-phase",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "procedure closed",
      "parserNote": ""
    },
    "ACOR": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ACOR",
      "sourceDescription": "Despatch of invitation to pay additional claims fees",
      "internalKey": "ADDITIONAL_CLAIMS_FEE_INVITATION_AFTER_ALLOWED_AMENDMENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create fee deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Grant-stage edge case after allowed amendment/correction."
    },
    "CDEC": {
      "codeNamespace": "procedural_step",
      "sourceCode": "CDEC",
      "sourceDescription": "Request for correction of the decision to grant filed",
      "internalKey": "CORRECTION_REQUEST_AFTER_GRANT_DECISION",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "incoming-request",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Store as branch affecting post-grant decision correction",
      "parserNote": "Do not confuse with Rule 71(3) amendment branch."
    },
    "0009012": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009012",
      "sourceDescription": "Publication in section I.1 EP Bulletin",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009199EPPU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199EPPU",
      "sourceDescription": "Change or deletion - publication of A document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0008199SEPU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008199SEPU",
      "sourceDescription": "Change - publication of search report",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009013": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009013",
      "sourceDescription": "Publication of search report",
      "internalKey": "SEARCH_REPORT_PUBLICATION",
      "procedureFamily": "EP_DIRECT",
      "phase": "search",
      "classification": "informational",
      "preferredSurface": "event_history/all_documents",
      "codexAction": "No standalone deadline; pair with Rule 70/70a path",
      "parserNote": "Use publication event as anchor for search-stage awareness, not reply deadline."
    },
    "0009015": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009015",
      "sourceDescription": "Publication of international search report",
      "internalKey": "ISR_PUBLICATION",
      "procedureFamily": "EURO_PCT",
      "phase": "pre-regional-phase",
      "classification": "informational",
      "preferredSurface": "event_history/all_documents",
      "codexAction": "No EP reply deadline from this event alone",
      "parserNote": "Useful for PCT chronology only."
    },
    "0009016": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009016",
      "sourceDescription": "Supplementary search report",
      "internalKey": "SUPPLEMENTARY_SEARCH_REPORT_PUBLICATION",
      "procedureFamily": "EURO_PCT",
      "phase": "search",
      "classification": "informational",
      "preferredSurface": "event_history/all_documents",
      "codexAction": "No standalone deadline; pair with downstream communication",
      "parserNote": "Useful for Euro-PCT search chronology."
    },
    "0009199SEPU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199SEPU",
      "sourceDescription": "Change or deletion - publication of search report",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009210": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009210",
      "sourceDescription": "(Expected) grant",
      "internalKey": "EXPECTED_GRANT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "expected B1 publication"
    },
    "0009299EPPU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299EPPU",
      "sourceDescription": "Change or deletion - publication of B1 document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009272": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009272",
      "sourceDescription": "Patent maintained (B2 publication)",
      "internalKey": "OPPOSITION_B2_PUBLICATION",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_endgame",
      "classification": "publication",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Close Rule 82 branch once publication confirmed",
      "parserNote": "Publication, not the underlying communication itself."
    },
    "0009299PMAP": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299PMAP",
      "sourceDescription": "Change - publication of B2 document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009399EPPU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009399EPPU",
      "sourceDescription": "Change or deletion - publication of B2 document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009410": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009410",
      "sourceDescription": "(Expected) limited patent specification",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009499EPPU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009499EPPU",
      "sourceDescription": "Change or deletion - publication of limited patent specification",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0008199WDRA": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008199WDRA",
      "sourceDescription": "Change - withdrawal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009182": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009182",
      "sourceDescription": "Withdrawal of application",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009199WDRA": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199WDRA",
      "sourceDescription": "Change - withdrawal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009299WDRA": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299WDRA",
      "sourceDescription": "Change - withdrawal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0008199ADWI": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008199ADWI",
      "sourceDescription": "Change or deletion - application deemed withdrawn",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009121": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009121",
      "sourceDescription": "Application deemed to be withdrawn",
      "internalKey": "LOSS_OF_RIGHTS_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "loss_of_rights",
      "classification": "consequence",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "No new response deadline by default; route to remedies",
      "parserNote": "Look for underlying missed act and possible further processing/re-establishment."
    },
    "0009183": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009183",
      "sourceDescription": "Application deemed to be withdrawn",
      "internalKey": "APPLICATION_DEEMED_WITHDRAWN",
      "procedureFamily": "ALL_EP",
      "phase": "loss_of_rights",
      "classification": "consequence",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "loss-of-rights published"
    },
    "0009199ADWI": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199ADWI",
      "sourceDescription": "Change or deletion - application deemed withdrawn",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009299ADWI": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299ADWI",
      "sourceDescription": "Change or deletion - application deemed withdrawn",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0008199REFU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008199REFU",
      "sourceDescription": "Change - refusal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009181": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009181",
      "sourceDescription": "Refusal of application",
      "internalKey": "REFUSAL_DECISION_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "decision",
      "classification": "decision",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Route to appeal branch",
      "parserNote": "Do not treat as ordinary office action."
    },
    "0009199REFU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199REFU",
      "sourceDescription": "Change - refusal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009299REFU": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299REFU",
      "sourceDescription": "Change - refusal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "EPIDOSNIGR1": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSNIGR1",
      "sourceDescription": "New entry: Communication of intention to grant a patent",
      "internalKey": "GRANT_R71_3_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Create 4-month candidate, but confirm exact despatch/date from document",
      "parserNote": "Use all_documents for legal date and supersession logic."
    },
    "EPIDOSCIGR1": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSCIGR1",
      "sourceDescription": "Change: Communication of intention to grant a patent",
      "internalKey": "GRANT_R71_3_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Refresh 4-month candidate, but confirm exact despatch/date from document",
      "parserNote": "Treat as update to Rule 71(3) state."
    },
    "EPIDOSDIGR1": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSDIGR1",
      "sourceDescription": "Deletion: Communication of intention to grant a patent",
      "internalKey": "GRANT_R71_3_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "deleted Rule 71(3) event"
    },
    "0009261": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009261",
      "sourceDescription": "No opposition filed within time limit",
      "internalKey": "NO_OPPOSITION_FILED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_end",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file",
      "codexAction": "Close opposition watch for the patent",
      "parserNote": "Post-grant status update."
    },
    "0009299DELT": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299DELT",
      "sourceDescription": "Change - no opposition filed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0008299OPPO": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008299OPPO",
      "sourceDescription": "Change - opposition filed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009260": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009260",
      "sourceDescription": "Opposition filed",
      "internalKey": "OPPOSITION_FILED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Create opposition case state; next real deadline usually from Rule 79/OREX/DOBS",
      "parserNote": "Not itself the proprietor reply communication."
    },
    "0009264": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009264",
      "sourceDescription": "Opposition withdrawn",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009274": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009274",
      "sourceDescription": "Opposition deemed not to have been filed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009299OPPB": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPB",
      "sourceDescription": "Opposition deemed not to have been filed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009299OPPO": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPO",
      "sourceDescription": "Change - opposition data/opponent's data or that of the opponent's representative",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009273": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009273",
      "sourceDescription": "Opposition rejected",
      "internalKey": "OPPOSITION_REJECTED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_decision",
      "classification": "decision",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Route to appeal branch",
      "parserNote": "Decision event."
    },
    "0009299REJO": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299REJO",
      "sourceDescription": "Change - rejection of opposition",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009275": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009275",
      "sourceDescription": "Opposition inadmissible",
      "internalKey": "OPPOSITION_INADMISSIBLE",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_decision",
      "classification": "decision",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "opposition inadmissible"
    },
    "0009299OPPA": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPA",
      "sourceDescription": "Opposition inadmissible",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009271": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009271",
      "sourceDescription": "Revocation of patent",
      "internalKey": "OPPOSITION_REVOCATION",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_decision",
      "classification": "decision",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "revocation in opposition"
    },
    "0009299REVO": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299REVO",
      "sourceDescription": "Change - revocation of patent",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009220": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009220",
      "sourceDescription": "Patent revoked on request of proprietor",
      "internalKey": "PROPRIETOR_REVOCATION",
      "procedureFamily": "LIMITATION_REVOCATION",
      "phase": "revocation_request",
      "classification": "decision",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "proprietor revocation"
    },
    "0009276": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009276",
      "sourceDescription": "Opposition procedure terminated - date of legal effect published",
      "internalKey": "OPPOSITION_TERMINATED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_closed",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file",
      "codexAction": "Close opposition case state",
      "parserNote": "Termination marker."
    },
    "0009299OPPC": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPC",
      "sourceDescription": "Change - opposition procedure terminated",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "EPIDOSNRFE2": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSNRFE2",
      "sourceDescription": "New entry: Renewal fee paid",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "EPIDOSCRFE2": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSCRFE2",
      "sourceDescription": "Change: Renewal fee paid",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "EPIDOSDRFE2": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSDRFE2",
      "sourceDescription": "Deletion: Renewal fee paid",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009250": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009250",
      "sourceDescription": "Lapse of the patent in a contracting state",
      "internalKey": "NATIONAL_LAPSE",
      "procedureFamily": "POST_GRANT_NATIONAL",
      "phase": "post_grant_national",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file/federated register",
      "codexAction": "Update national status only",
      "parserNote": "National post-grant layer, not central EP procedure."
    },
    "0009299LAPS": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299LAPS",
      "sourceDescription": "Change - lapse in a contracting state",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0008199LREG": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008199LREG",
      "sourceDescription": "Change - licence",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009199LREG": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199LREG",
      "sourceDescription": "Change - licence",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009341": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009341",
      "sourceDescription": "Licence",
      "internalKey": "LICENCE_EVENT",
      "procedureFamily": "POST_GRANT_NATIONAL",
      "phase": "post_grant_national",
      "classification": "status",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "licence data"
    },
    "0009702UREQ10": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009702UREQ10",
      "sourceDescription": "Request for unitary effect withdrawn",
      "internalKey": "UP_REQUEST_WITHDRAWN",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_request",
      "classification": "status",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "request for unitary effect withdrawn"
    },
    "0009799UREQ10": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREQ10",
      "sourceDescription": "Change or deletion – Date of withdrawal of request for unitary effect",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009701UREQ02": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009701UREQ02",
      "sourceDescription": "Decision on the request for unitary effect",
      "internalKey": "UP_REQUEST_DECISION",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_request",
      "classification": "decision",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "decision on unitary effect request"
    },
    "0009799UREQ02": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREQ02",
      "sourceDescription": "Change or deletion – Date of decision on the request for unitary effect",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009700UREQ01": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009700UREQ01",
      "sourceDescription": "Filing of request for unitary effect",
      "internalKey": "UP_REQUEST_FILED",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_request",
      "classification": "status",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "unitary effect request filed"
    },
    "0009799UREQ01": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREQ01",
      "sourceDescription": "Change: Date of filing of request for unitary request",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009705LAPS22": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009705LAPS22",
      "sourceDescription": "Unitary effect lapsed",
      "internalKey": "UP_LAPSE",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_post_registration",
      "classification": "consequence",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "unitary effect lapsed"
    },
    "0009799LAPS22": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799LAPS22",
      "sourceDescription": "Change or deletion: unitary effect lapse date",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009706REES22": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009706REES22",
      "sourceDescription": "Request for re-establishment of rights filed",
      "internalKey": "UP_REESTABLISHMENT_REQUEST",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_post_registration",
      "classification": "remedial branch",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "re-establishment request filed"
    },
    "0009799REES22": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799REES22",
      "sourceDescription": "Change or deletion: Date of request for re-establishment of rights",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009704UDLA02": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009704UDLA02",
      "sourceDescription": "Renewal fees not paid: Unitary Patent Protection lapsed",
      "internalKey": "UP_LAPSE_RENEWAL",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_post_registration",
      "classification": "consequence",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "UP lapse for unpaid renewal fee"
    },
    "0009799UDLA02": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UDLA02",
      "sourceDescription": "Change: Renewal fees not paid: Unitary Patent Protection lapsed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "0009799UREG01": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREG01",
      "sourceDescription": "Change or deletion – Date of registration of Unitary Patent Protection",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    }
  },
  "byDescription": {
    "amendments": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ABEX",
      "sourceDescription": "Amendments",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "application deemed to be withdrawn": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ADWI",
      "sourceDescription": "Application deemed to be withdrawn",
      "internalKey": "LOSS_OF_RIGHTS_R112",
      "procedureFamily": "ALL_EP",
      "phase": "loss_of_rights",
      "classification": "consequence",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Link to underlying missed act using STEP_DESCRIPTION_NAME",
      "parserNote": "Reason strings include missed examination reply, EESR reply, prior-art info, fees, etc."
    },
    "communication of observations of proprietor": {
      "codeNamespace": "procedural_step",
      "sourceCode": "DOBS",
      "sourceDescription": "Communication of observations of proprietor",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "opposition",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "time-limit in record",
      "parserNote": ""
    },
    "invitation to indicate the basis for amendments": {
      "codeNamespace": "procedural_step",
      "sourceCode": "EXRE",
      "sourceDescription": "Invitation to indicate the basis for amendments",
      "internalKey": "AMENDMENT_BASIS_INVITATION",
      "procedureFamily": "ALL_EP",
      "phase": "examination",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Good structured marker for Rule 137(4)-type issue."
    },
    "payment of national basic fee": {
      "codeNamespace": "procedural_step",
      "sourceCode": "FFEE",
      "sourceDescription": "Payment of national basic fee",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "entry-regional-phase",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "interlocutory decision in opposition": {
      "codeNamespace": "procedural_step",
      "sourceCode": "IDOP",
      "sourceDescription": "Interlocutory decision in opposition",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "opposition",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "decision",
      "parserNote": ""
    },
    "intention to grant the patent": {
      "codeNamespace": "procedural_step",
      "sourceCode": "IGRA",
      "sourceDescription": "Intention to grant the patent",
      "internalKey": "GRANT_R71_3",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create 4-month candidate from DATE_OF_DISPATCH; prefer actual document despatch/date",
      "parserNote": "Also stores grant fee / print fee / translation dates."
    },
    "disapproval of the communication of intention to grant the patent": {
      "codeNamespace": "procedural_step",
      "sourceCode": "IGRE",
      "sourceDescription": "Disapproval of the communication of intention to grant the patent",
      "internalKey": "GRANT_R71_6_DISAPPROVAL",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "incoming-response",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use as applicant action affecting grant branch",
      "parserNote": "May lead to fresh Rule 71(3) or resumed examination."
    },
    "international searching authority": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ISAT",
      "sourceDescription": "International searching authority",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "entry-regional-phase",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "communication from the examining division in a limitation procedure": {
      "codeNamespace": "procedural_step",
      "sourceCode": "LIRE",
      "sourceDescription": "Communication from the examining division in a limitation procedure",
      "internalKey": "LIMITATION_COMMUNICATION",
      "procedureFamily": "LIMITATION_REVOCATION",
      "phase": "limitation",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Limitation-specific communication family."
    },
    "oral proceedings": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ORAL",
      "sourceDescription": "Oral proceedings",
      "internalKey": "ORAL_PROCEEDINGS_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "examination/opposition/appeal",
      "classification": "hearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Store OP date(s); parse annex separately for Rule 116 final date",
      "parserNote": "The event itself is not enough for final-date logic."
    },
    "communication from the opposition division": {
      "codeNamespace": "procedural_step",
      "sourceCode": "OREX",
      "sourceDescription": "Communication from the opposition division",
      "internalKey": "OPPOSITION_DIVISION_COMMUNICATION",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Strong structured marker for opposition communications."
    },
    "invitation to provide information on prior art": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PART",
      "sourceDescription": "Invitation to provide information on prior art",
      "internalKey": "PRIOR_ART_INFORMATION_INVITATION",
      "procedureFamily": "ALL_EP",
      "phase": "examination",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create deadline from DATE_OF_DISPATCH + available time-limit/manual review",
      "parserNote": "Often relevant to later ADWI / RFPR routing."
    },
    "penalty fee / additional fee": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PFEE",
      "sourceDescription": "Penalty fee / additional fee",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "time-limit in record",
      "parserNote": ""
    },
    "preparation for maintenance of the patent in an amended form": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PMAP",
      "sourceDescription": "Preparation for maintenance of the patent in an amended form",
      "internalKey": "OPPOSITION_R82_BRANCH",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_endgame",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use DATE_OF_DISPATCH as Rule 82 branch anchor and track payment",
      "parserNote": "Maps well to Rule 82(1)/(2) maintenance logic."
    },
    "preliminary examination - pct ii": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PREX",
      "sourceDescription": "Preliminary examination - PCT II",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "international-examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "language of the procedure": {
      "codeNamespace": "procedural_step",
      "sourceCode": "PROL",
      "sourceDescription": "Language of the procedure",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "all",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "request for accelerated examination": {
      "codeNamespace": "procedural_step",
      "sourceCode": "RAEX",
      "sourceDescription": "Request for accelerated examination",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "examination",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "rejection of the request for revocation of the patent": {
      "codeNamespace": "procedural_step",
      "sourceCode": "REJR",
      "sourceDescription": "Rejection of the request for revocation of the patent",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "revocation",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "decision",
      "parserNote": ""
    },
    "renewal fee payment": {
      "codeNamespace": "procedural_step",
      "sourceCode": "RFEE",
      "sourceDescription": "Renewal fee payment",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "all",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "none",
      "parserNote": ""
    },
    "request for further processing": {
      "codeNamespace": "procedural_step",
      "sourceCode": "RFPR",
      "sourceDescription": "Request for further processing",
      "internalKey": "FURTHER_PROCESSING_REQUEST",
      "procedureFamily": "ALL_EP",
      "phase": "remedial",
      "classification": "remedial",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Attach to missed act using STEP_DESCRIPTION_NAME and record result",
      "parserNote": "Central remedial branch for many missed deadlines."
    },
    "fee for a supplementary search": {
      "codeNamespace": "procedural_step",
      "sourceCode": "SFEE",
      "sourceDescription": "Fee for a supplementary search",
      "internalKey": "SUPPLEMENTARY_SEARCH_FEE_PAYMENT",
      "procedureFamily": "EURO_PCT",
      "phase": "regional_phase_entry",
      "classification": "payment",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use as Euro-PCT entry/compliance signal, not communication deadline",
      "parserNote": "One of the regional-phase acts."
    },
    "translation of the application": {
      "codeNamespace": "procedural_step",
      "sourceCode": "TRAN",
      "sourceDescription": "Translation of the application",
      "internalKey": "EURO_PCT_TRANSLATION_RECEIVED",
      "procedureFamily": "EURO_PCT",
      "phase": "regional_phase_entry",
      "classification": "filing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use as Euro-PCT entry/compliance signal",
      "parserNote": "One of the regional-phase acts."
    },
    "first communication from the examining division": {
      "codeNamespace": "procedural_step",
      "sourceCode": "DDIV",
      "sourceDescription": "First communication from the examining division",
      "internalKey": "FIRST_EXAM_COMM_DIVISIONAL_MARKER",
      "procedureFamily": "ALL_EP",
      "phase": "examination",
      "classification": "marker",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Use for divisional-window logic and examination chronology",
      "parserNote": "Not necessarily the full text of the communication."
    },
    "withdrawal during international phase - procedure closed": {
      "codeNamespace": "procedural_step",
      "sourceCode": "WINT",
      "sourceDescription": "Withdrawal during international phase - procedure closed",
      "internalKey": "",
      "procedureFamily": "",
      "phase": "entry-regional-phase",
      "classification": "",
      "preferredSurface": "st36/all_documents",
      "codexAction": "procedure closed",
      "parserNote": ""
    },
    "despatch of invitation to pay additional claims fees": {
      "codeNamespace": "procedural_step",
      "sourceCode": "ACOR",
      "sourceDescription": "Despatch of invitation to pay additional claims fees",
      "internalKey": "ADDITIONAL_CLAIMS_FEE_INVITATION_AFTER_ALLOWED_AMENDMENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Create fee deadline from DATE_OF_DISPATCH + time-limit in record",
      "parserNote": "Grant-stage edge case after allowed amendment/correction."
    },
    "request for correction of the decision to grant filed": {
      "codeNamespace": "procedural_step",
      "sourceCode": "CDEC",
      "sourceDescription": "Request for correction of the decision to grant filed",
      "internalKey": "CORRECTION_REQUEST_AFTER_GRANT_DECISION",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "incoming-request",
      "preferredSurface": "all_documents/ST36 procedural-data",
      "codexAction": "Store as branch affecting post-grant decision correction",
      "parserNote": "Do not confuse with Rule 71(3) amendment branch."
    },
    "publication in section i.1 ep bulletin": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009012",
      "sourceDescription": "Publication in section I.1 EP Bulletin",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change or deletion - publication of a document": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199EPPU",
      "sourceDescription": "Change or deletion - publication of A document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change - publication of search report": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008199SEPU",
      "sourceDescription": "Change - publication of search report",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "publication of search report": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009013",
      "sourceDescription": "Publication of search report",
      "internalKey": "SEARCH_REPORT_PUBLICATION",
      "procedureFamily": "EP_DIRECT",
      "phase": "search",
      "classification": "informational",
      "preferredSurface": "event_history/all_documents",
      "codexAction": "No standalone deadline; pair with Rule 70/70a path",
      "parserNote": "Use publication event as anchor for search-stage awareness, not reply deadline."
    },
    "publication of international search report": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009015",
      "sourceDescription": "Publication of international search report",
      "internalKey": "ISR_PUBLICATION",
      "procedureFamily": "EURO_PCT",
      "phase": "pre-regional-phase",
      "classification": "informational",
      "preferredSurface": "event_history/all_documents",
      "codexAction": "No EP reply deadline from this event alone",
      "parserNote": "Useful for PCT chronology only."
    },
    "supplementary search report": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009016",
      "sourceDescription": "Supplementary search report",
      "internalKey": "SUPPLEMENTARY_SEARCH_REPORT_PUBLICATION",
      "procedureFamily": "EURO_PCT",
      "phase": "search",
      "classification": "informational",
      "preferredSurface": "event_history/all_documents",
      "codexAction": "No standalone deadline; pair with downstream communication",
      "parserNote": "Useful for Euro-PCT search chronology."
    },
    "change or deletion - publication of search report": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199SEPU",
      "sourceDescription": "Change or deletion - publication of search report",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "(expected) grant": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009210",
      "sourceDescription": "(Expected) grant",
      "internalKey": "EXPECTED_GRANT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "expected B1 publication"
    },
    "change or deletion - publication of b1 document": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299EPPU",
      "sourceDescription": "Change or deletion - publication of B1 document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "patent maintained (b2 publication)": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009272",
      "sourceDescription": "Patent maintained (B2 publication)",
      "internalKey": "OPPOSITION_B2_PUBLICATION",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_endgame",
      "classification": "publication",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Close Rule 82 branch once publication confirmed",
      "parserNote": "Publication, not the underlying communication itself."
    },
    "change - publication of b2 document": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299PMAP",
      "sourceDescription": "Change - publication of B2 document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change or deletion - publication of b2 document": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009399EPPU",
      "sourceDescription": "Change or deletion - publication of B2 document",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "(expected) limited patent specification": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009410",
      "sourceDescription": "(Expected) limited patent specification",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change or deletion - publication of limited patent specification": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009499EPPU",
      "sourceDescription": "Change or deletion - publication of limited patent specification",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change - withdrawal": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299WDRA",
      "sourceDescription": "Change - withdrawal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "withdrawal of application": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009182",
      "sourceDescription": "Withdrawal of application",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change or deletion - application deemed withdrawn": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299ADWI",
      "sourceDescription": "Change or deletion - application deemed withdrawn",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change - refusal": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299REFU",
      "sourceDescription": "Change - refusal",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "refusal of application": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009181",
      "sourceDescription": "Refusal of application",
      "internalKey": "REFUSAL_DECISION_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "decision",
      "classification": "decision",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Route to appeal branch",
      "parserNote": "Do not treat as ordinary office action."
    },
    "new entry: communication of intention to grant a patent": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSNIGR1",
      "sourceDescription": "New entry: Communication of intention to grant a patent",
      "internalKey": "GRANT_R71_3_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Create 4-month candidate, but confirm exact despatch/date from document",
      "parserNote": "Use all_documents for legal date and supersession logic."
    },
    "change: communication of intention to grant a patent": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSCIGR1",
      "sourceDescription": "Change: Communication of intention to grant a patent",
      "internalKey": "GRANT_R71_3_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "deadline-bearing",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Refresh 4-month candidate, but confirm exact despatch/date from document",
      "parserNote": "Treat as update to Rule 71(3) state."
    },
    "deletion: communication of intention to grant a patent": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSDIGR1",
      "sourceDescription": "Deletion: Communication of intention to grant a patent",
      "internalKey": "GRANT_R71_3_EVENT",
      "procedureFamily": "ALL_EP",
      "phase": "grant",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "deleted Rule 71(3) event"
    },
    "no opposition filed within time limit": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009261",
      "sourceDescription": "No opposition filed within time limit",
      "internalKey": "NO_OPPOSITION_FILED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_end",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file",
      "codexAction": "Close opposition watch for the patent",
      "parserNote": "Post-grant status update."
    },
    "change - no opposition filed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299DELT",
      "sourceDescription": "Change - no opposition filed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change - opposition filed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0008299OPPO",
      "sourceDescription": "Change - opposition filed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "opposition filed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009260",
      "sourceDescription": "Opposition filed",
      "internalKey": "OPPOSITION_FILED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Create opposition case state; next real deadline usually from Rule 79/OREX/DOBS",
      "parserNote": "Not itself the proprietor reply communication."
    },
    "opposition withdrawn": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009264",
      "sourceDescription": "Opposition withdrawn",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "opposition deemed not to have been filed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPB",
      "sourceDescription": "Opposition deemed not to have been filed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change - opposition data/opponent's data or that of the opponent's representative": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPO",
      "sourceDescription": "Change - opposition data/opponent's data or that of the opponent's representative",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "opposition rejected": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009273",
      "sourceDescription": "Opposition rejected",
      "internalKey": "OPPOSITION_REJECTED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_decision",
      "classification": "decision",
      "preferredSurface": "event_history/about_this_file/all_documents",
      "codexAction": "Route to appeal branch",
      "parserNote": "Decision event."
    },
    "change - rejection of opposition": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299REJO",
      "sourceDescription": "Change - rejection of opposition",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "opposition inadmissible": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPA",
      "sourceDescription": "Opposition inadmissible",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "revocation of patent": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009271",
      "sourceDescription": "Revocation of patent",
      "internalKey": "OPPOSITION_REVOCATION",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_decision",
      "classification": "decision",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "revocation in opposition"
    },
    "change - revocation of patent": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299REVO",
      "sourceDescription": "Change - revocation of patent",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "patent revoked on request of proprietor": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009220",
      "sourceDescription": "Patent revoked on request of proprietor",
      "internalKey": "PROPRIETOR_REVOCATION",
      "procedureFamily": "LIMITATION_REVOCATION",
      "phase": "revocation_request",
      "classification": "decision",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "proprietor revocation"
    },
    "opposition procedure terminated - date of legal effect published": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009276",
      "sourceDescription": "Opposition procedure terminated - date of legal effect published",
      "internalKey": "OPPOSITION_TERMINATED",
      "procedureFamily": "POST_GRANT_OPPOSITION",
      "phase": "opposition_closed",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file",
      "codexAction": "Close opposition case state",
      "parserNote": "Termination marker."
    },
    "change - opposition procedure terminated": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299OPPC",
      "sourceDescription": "Change - opposition procedure terminated",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "new entry: renewal fee paid": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSNRFE2",
      "sourceDescription": "New entry: Renewal fee paid",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change: renewal fee paid": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSCRFE2",
      "sourceDescription": "Change: Renewal fee paid",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "deletion: renewal fee paid": {
      "codeNamespace": "register_main_event",
      "sourceCode": "EPIDOSDRFE2",
      "sourceDescription": "Deletion: Renewal fee paid",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "lapse of the patent in a contracting state": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009250",
      "sourceDescription": "Lapse of the patent in a contracting state",
      "internalKey": "NATIONAL_LAPSE",
      "procedureFamily": "POST_GRANT_NATIONAL",
      "phase": "post_grant_national",
      "classification": "status",
      "preferredSurface": "event_history/about_this_file/federated register",
      "codexAction": "Update national status only",
      "parserNote": "National post-grant layer, not central EP procedure."
    },
    "change - lapse in a contracting state": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009299LAPS",
      "sourceDescription": "Change - lapse in a contracting state",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change - licence": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009199LREG",
      "sourceDescription": "Change - licence",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "licence": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009341",
      "sourceDescription": "Licence",
      "internalKey": "LICENCE_EVENT",
      "procedureFamily": "POST_GRANT_NATIONAL",
      "phase": "post_grant_national",
      "classification": "status",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "licence data"
    },
    "request for unitary effect withdrawn": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009702UREQ10",
      "sourceDescription": "Request for unitary effect withdrawn",
      "internalKey": "UP_REQUEST_WITHDRAWN",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_request",
      "classification": "status",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "request for unitary effect withdrawn"
    },
    "change or deletion – date of withdrawal of request for unitary effect": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREQ10",
      "sourceDescription": "Change or deletion – Date of withdrawal of request for unitary effect",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "decision on the request for unitary effect": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009701UREQ02",
      "sourceDescription": "Decision on the request for unitary effect",
      "internalKey": "UP_REQUEST_DECISION",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_request",
      "classification": "decision",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "decision on unitary effect request"
    },
    "change or deletion – date of decision on the request for unitary effect": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREQ02",
      "sourceDescription": "Change or deletion – Date of decision on the request for unitary effect",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "filing of request for unitary effect": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009700UREQ01",
      "sourceDescription": "Filing of request for unitary effect",
      "internalKey": "UP_REQUEST_FILED",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_request",
      "classification": "status",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "unitary effect request filed"
    },
    "change: date of filing of request for unitary request": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREQ01",
      "sourceDescription": "Change: Date of filing of request for unitary request",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "unitary effect lapsed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009705LAPS22",
      "sourceDescription": "Unitary effect lapsed",
      "internalKey": "UP_LAPSE",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_post_registration",
      "classification": "consequence",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "unitary effect lapsed"
    },
    "change or deletion: unitary effect lapse date": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799LAPS22",
      "sourceDescription": "Change or deletion: unitary effect lapse date",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "request for re-establishment of rights filed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009706REES22",
      "sourceDescription": "Request for re-establishment of rights filed",
      "internalKey": "UP_REESTABLISHMENT_REQUEST",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_post_registration",
      "classification": "remedial branch",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "re-establishment request filed"
    },
    "change or deletion: date of request for re-establishment of rights": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799REES22",
      "sourceDescription": "Change or deletion: Date of request for re-establishment of rights",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "renewal fees not paid: unitary patent protection lapsed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009704UDLA02",
      "sourceDescription": "Renewal fees not paid: Unitary Patent Protection lapsed",
      "internalKey": "UP_LAPSE_RENEWAL",
      "procedureFamily": "UNITARY_PATENT",
      "phase": "up_post_registration",
      "classification": "consequence",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "branch to consequence/decision logic",
      "parserNote": "UP lapse for unpaid renewal fee"
    },
    "change: renewal fees not paid: unitary patent protection lapsed": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UDLA02",
      "sourceDescription": "Change: Renewal fees not paid: Unitary Patent Protection lapsed",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    },
    "change or deletion – date of registration of unitary patent protection": {
      "codeNamespace": "register_main_event",
      "sourceCode": "0009799UREG01",
      "sourceDescription": "Change or deletion – Date of registration of Unitary Patent Protection",
      "internalKey": "UNMAPPED_MAIN_EVENT",
      "procedureFamily": "UNKNOWN",
      "phase": "unknown",
      "classification": "informational",
      "preferredSurface": "event_history + about_this_file + all_documents",
      "codexAction": "monitor",
      "parserNote": "map in your own taxonomy"
    }
  }
});

  const SOURCES = [
    { key: 'main', slug: 'main', title: 'EP About this file' },
    { key: 'doclist', slug: 'doclist', title: 'EP All documents' },
    { key: 'event', slug: 'event', title: 'EP Event history' },
    { key: 'family', slug: 'family', title: 'EP Patent family' },
    { key: 'legal', slug: 'legal', title: 'EP Legal status' },
    { key: 'federated', slug: 'federated', title: 'EP Federated register' },
    { key: 'citations', slug: 'citations', title: 'EP Citations' },
    { key: 'ueMain', slug: 'ueMain', title: 'UP About this file' },
  ];

  const DEFAULTS = {
    shiftBody: true,
    panelWidthPx: 430,
    pageRightPaddingPx: 450,
    preloadAllTabs: true,
    refreshHours: 6,
    timelineMaxEntries: 350,
    showPublications: false,
    showEventHistory: false,
    showLegalStatusRows: false,
    showRenewals: true,
    showUpcUe: true,
    showCitations: true,
    doclistGroupsExpandedByDefault: true,
    timelineDensity: 'standard',
    timelineEventLevel: 'info',
    timelineLegalLevel: 'warn',
  };

  const OPTION_SECTIONS = [
    { key: 'layout', title: 'Layout', help: 'Panel placement and page-shift behaviour.' },
    { key: 'data', title: 'Data loading', help: 'How aggressively the sidebar prefetches Register sources.' },
    { key: 'overview', title: 'Overview panels', help: 'Show or hide overview cards.' },
    { key: 'timeline', title: 'Timeline', help: 'Timeline density and which sources feed it.' },
    { key: 'doclist', title: 'Doclist grouping', help: 'How grouped document packets behave on the doclist tab.' },
  ];

  const OPTION_DEFS = [
    { section: 'layout', kind: 'checkbox', key: 'shiftBody', id: 'epoRP-opt-shift', title: 'Shift page body', help: 'Adds right padding so Register content is not hidden under panel.' },
    { section: 'data', kind: 'checkbox', key: 'preloadAllTabs', id: 'epoRP-opt-preload', title: 'Preload all case tabs in background', help: 'Loads main/doclist/event/family/legal/federated/citations/ueMain in background and fills cache.' },
    { section: 'overview', kind: 'checkbox', key: 'showRenewals', id: 'epoRP-opt-ren', title: 'Show renewals panel', help: 'Displays pre-/post-grant and UE-sensitive renewal explanation in Overview.' },
    { section: 'overview', kind: 'checkbox', key: 'showUpcUe', id: 'epoRP-opt-upc', title: 'Show UPC/UE panel', help: 'Displays inferred UE + UPC opt-out state with notes.' },
    { section: 'overview', kind: 'checkbox', key: 'showCitations', id: 'epoRP-opt-cit', title: 'Show citations panel', help: 'Displays a compact cited-art summary grouped by phase.' },
    { section: 'timeline', kind: 'checkbox', key: 'showPublications', id: 'epoRP-opt-pubs', title: 'Show publications on timeline', help: 'Includes publication entries from main + family sources.' },
    { section: 'timeline', kind: 'checkbox', key: 'showEventHistory', id: 'epoRP-opt-events', title: 'Show event-history rows', help: 'Includes EP Event history source rows in timeline.' },
    { section: 'timeline', kind: 'checkbox', key: 'showLegalStatusRows', id: 'epoRP-opt-legal', title: 'Show legal-status rows', help: 'Includes EP Legal status rows in timeline.' },
    { section: 'timeline', kind: 'select', key: 'timelineDensity', id: 'epoRP-opt-density', title: 'Timeline density', help: 'Compact / standard / verbose visual density.', choices: [
      { value: 'compact', label: 'Compact' },
      { value: 'standard', label: 'Standard' },
      { value: 'verbose', label: 'Verbose' },
    ] },
    { section: 'timeline', kind: 'select', key: 'timelineEventLevel', id: 'epoRP-opt-event-level', title: 'Timeline event importance', help: 'Visual severity for event-history items.', choices: [
      { value: 'info', label: 'Info' },
      { value: 'warn', label: 'Warn' },
      { value: 'bad', label: 'High' },
      { value: 'ok', label: 'Low' },
    ] },
    { section: 'timeline', kind: 'select', key: 'timelineLegalLevel', id: 'epoRP-opt-legal-level', title: 'Timeline legal importance', help: 'Visual severity for legal-status items.', choices: [
      { value: 'warn', label: 'Warn' },
      { value: 'info', label: 'Info' },
      { value: 'bad', label: 'High' },
      { value: 'ok', label: 'Low' },
    ] },
    { section: 'doclist', kind: 'checkbox', key: 'doclistGroupsExpandedByDefault', id: 'epoRP-opt-docgrp-default-open', title: 'Expand doclist groups by default', help: 'When there is no saved per-group state yet, open groups automatically instead of starting collapsed.' },
  ];

  const OPTION_DEFS_BY_KEY = Object.fromEntries(OPTION_DEFS.map((def) => [def.key, def]));

  const runtime = {
    appNo: '',
    href: location.href,
    activeView: loadJson(UI_KEY, {}).activeView || 'overview',
    collapsed: !!loadJson(UI_KEY, {}).collapsed,
    panel: null,
    body: null,
    fetching: false,
    fetchLabel: 'Idle',
    abortController: null,
    fetchCaseNo: null,
    scrollSaveTimer: null,
    timelineCache: { key: '', items: [] },
    overviewCache: { key: '', model: null },
    doclistGroupSigByCase: {},
    pdfjsPromise: null,
    tesseractPromise: null,
    autoPrefetchDoneByCase: {},
    lastRegisterTabByCase: {},
    lastViewLogKey: '',
    routeTimer: null,
    pendingInitForce: false,
  };

  let memory = null;
  let optionsShadow = null;
  let sessionShadow = null;
  let dirty = false;
  let flushTimer = null;
  let renderTimer = null;
  let initTimer = null;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    const payload = JSON.stringify(value);
    try {
      localStorage.setItem(key, payload);
      return true;
    } catch (error) {
      const msg = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
      const isQuota = msg.includes('quota') || msg.includes('exceeded');
      if (!isQuota) return false;

      // Try to free room by compacting cache before giving up on options/UI writes.
      if (key !== CACHE_KEY) {
        try {
          evictOldCases();
          if (memory) localStorage.setItem(CACHE_KEY, JSON.stringify(memory));
          localStorage.setItem(key, payload);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  function loadSessionJson(key, fallback) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveSessionJson(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalize(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function dedupeMultiline(value) {
    const raw = normalize(value);
    if (!raw) return '';

    const lines = raw.split('\n').map((v) => normalize(v)).filter(Boolean);
    const uniqueLines = [];
    for (const line of lines) {
      if (uniqueLines[uniqueLines.length - 1] === line) continue;
      uniqueLines.push(line);
    }

    if (uniqueLines.length % 2 === 0) {
      const half = uniqueLines.length / 2;
      const a = uniqueLines.slice(0, half).join('\n');
      const b = uniqueLines.slice(half).join('\n');
      if (a && a === b) return a;
    }

    return uniqueLines.join('\n');
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(node) {
    return node ? normalize(node.innerText || node.textContent || '') : '';
  }

  function parseDateString(value) {
    const m = String(value || '').match(DATE_RE);
    if (!m) return null;
    const [d, mth, y] = m[1].split('.').map(Number);
    const dt = new Date(y, mth - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function formatDate(dt) {
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
  }

  function compareDateDesc(a, b) {
    return (parseDateString(b?.dateStr)?.getTime() || 0) - (parseDateString(a?.dateStr)?.getTime() || 0);
  }

  function dedupe(items, keyFn) {
    const out = [];
    const seen = new Set();
    for (const item of items || []) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function bodyText(doc) {
    return normalize(doc?.body?.innerText || doc?.body?.textContent || '');
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html || '', 'text/html');
  }

  function appStore() {
    if (memory) return memory;
    const loaded = loadJson(CACHE_KEY, null);
    if (!loaded || typeof loaded !== 'object') {
      memory = { schema: CACHE_SCHEMA, apps: {} };
      return memory;
    }
    if (!loaded.schema || loaded.schema !== CACHE_SCHEMA) {
      memory = { schema: CACHE_SCHEMA, apps: loaded.apps || {} };
      return memory;
    }
    memory = loaded;
    if (!memory.apps) memory.apps = {};
    return memory;
  }

  function markDirty() {
    dirty = true;
    if (!flushTimer) flushTimer = setTimeout(flushCache, 500);
  }

  function evictOldCases() {
    const s = appStore();
    const keys = Object.keys(s.apps || {});
    if (keys.length <= MAX_CASES) return;
    keys
      .sort((a, b) => (s.apps[a]?.updatedAt || 0) - (s.apps[b]?.updatedAt || 0))
      .slice(0, keys.length - MAX_CASES)
      .forEach((k) => delete s.apps[k]);
  }

  function flushCache() {
    flushTimer = null;
    if (!dirty || !memory) return;
    dirty = false;
    evictOldCases();
    saveJson(CACHE_KEY, memory);
  }

  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!dirty || !memory) return;
    dirty = false;
    evictOldCases();
    saveJson(CACHE_KEY, memory);
  }

  function getCase(caseNo) {
    const store = appStore();
    if (!store.apps[caseNo]) {
      store.apps[caseNo] = {
        appNo: caseNo,
        updatedAt: 0,
        sources: {},
        logs: [],
      };
      markDirty();
    }
    if (!Array.isArray(store.apps[caseNo].logs)) store.apps[caseNo].logs = [];
    if (!store.apps[caseNo].sources || typeof store.apps[caseNo].sources !== 'object') store.apps[caseNo].sources = {};
    return store.apps[caseNo];
  }

  function patchCase(caseNo, mutator) {
    const store = appStore();
    if (!store.apps[caseNo]) {
      store.apps[caseNo] = { appNo: caseNo, updatedAt: 0, sources: {}, logs: [] };
    }
    mutator(store.apps[caseNo]);
    store.apps[caseNo].updatedAt = Date.now();
    markDirty();
    return store.apps[caseNo];
  }

  function syncMainSourceMeta(caseEntry, data) {
    if (!caseEntry || !data || typeof data !== 'object') return;
    caseEntry.meta = caseEntry.meta || {};
    caseEntry.meta.lastMainStatusRaw = String(data?.statusRaw || '');
    caseEntry.meta.lastMainStage = String(data?.statusStage || inferStatusStage(data?.statusRaw || '') || '');
  }

  function clearMainSourceMeta(caseEntry) {
    if (!caseEntry) return;
    caseEntry.meta = caseEntry.meta || {};
    caseEntry.meta.lastMainStatusRaw = '';
    caseEntry.meta.lastMainStage = '';
  }

  function storeCaseSource(caseNo, key, payload = {}) {
    if (!caseNo || !key) return null;
    const title = payload.title || sourceTitle(key);
    return patchCase(caseNo, (c) => {
      const next = {
        key,
        title,
        status: payload.status || 'ok',
        fetchedAt: payload.fetchedAt || Date.now(),
        parserVersion: payload.parserVersion || VERSION,
      };

      if (payload.url) next.url = payload.url;
      if (payload.transport) next.transport = payload.transport;
      if (payload.dependencyStamp != null) next.dependencyStamp = String(payload.dependencyStamp || '');
      if (payload.error) next.error = String(payload.error || '');
      if (payload.data !== undefined) next.data = payload.data;

      c.sources[key] = next;
      if (key === 'main') {
        if (payload.data && payload.status === 'ok') syncMainSourceMeta(c, payload.data);
        else clearMainSourceMeta(c);
      }
    });
  }

  function addLog(caseNo, level, message, meta = {}) {
    try {
      const normalizedLevel = String(level || 'info').toLowerCase();
      const normalizedMessage = normalize(String(message || '')) || '(no message)';
      const normalizedMeta = (meta && typeof meta === 'object' && !Array.isArray(meta)) ? meta : {};

      patchCase(caseNo, (c) => {
        const last = c.logs?.[c.logs.length - 1];
        if (last && String(last.level || '').toLowerCase() === normalizedLevel && String(last.message || '') === normalizedMessage) {
          const lastTs = new Date(last.ts || '').getTime();
          const delta = Number.isFinite(lastTs) ? Date.now() - lastTs : Infinity;
          if (delta >= 0 && delta < 900) {
            const sameMeta = safeInlineJson(last.meta || {}) === safeInlineJson(normalizedMeta);
            if (sameMeta) return;
          }
        }

        c.logs.push({ ts: nowIso(), level: normalizedLevel, message: normalizedMessage, meta: normalizedMeta });
        if (c.logs.length > MAX_LOGS_PER_APP) c.logs = c.logs.slice(-MAX_LOGS_PER_APP);
      });
    } catch {
      // logging must never break script
    }
  }

  function formatLogClock(ts) {
    const dt = new Date(ts || '');
    if (Number.isNaN(dt.getTime())) return '--:--:--';
    return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
  }

  function safeInlineJson(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }

  function renderLogConsole(caseNo) {
    const logs = (getCase(caseNo).logs || []).slice(-MAX_LOGS_PER_APP).reverse();
    if (!logs.length) {
      return `<div class="epoRP-log-empty">No operation logs yet for this case.</div>`;
    }

    return logs.map((entry) => {
      const level = String(entry?.level || 'info').toLowerCase();
      const levelClass = ['ok', 'info', 'warn', 'bad', 'error'].includes(level) ? level : 'info';
      const message = normalize(String(entry?.message || '')) || '(no message)';
      const meta = entry?.meta && typeof entry.meta === 'object' && !Array.isArray(entry.meta) ? entry.meta : {};
      const metaText = Object.keys(meta).length ? ` ${safeInlineJson(meta)}` : '';

      return `<div class="epoRP-log-row ${esc(levelClass)}">
        <div class="epoRP-log-ts">${esc(formatLogClock(entry?.ts))}</div>
        <div class="epoRP-log-lv">${esc(levelClass.toUpperCase())}</div>
        <div class="epoRP-log-msg">${esc(message)}${metaText ? `<span class="epoRP-log-meta">${esc(metaText)}</span>` : ''}</div>
      </div>`;
    }).join('');
  }

  function optionValueText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value == null) return 'null';
    return safeInlineJson(value);
  }

  function optionSnapshotKeys(optionState = options()) {
    const knownKeys = OPTION_DEFS.map((def) => def.key);
    const knownSet = new Set(knownKeys);
    const extraKeys = Object.keys(optionState).filter((key) => !knownSet.has(key)).sort((a, b) => a.localeCompare(b));
    return [...knownKeys, ...extraKeys];
  }

  function renderOptionSnapshot() {
    const o = options();
    return optionSnapshotKeys(o).map((key) => `<div class="epoRP-optval-row"><div class="epoRP-optval-k">${esc(key)}</div><div class="epoRP-optval-v">${esc(optionValueText(o[key]))}</div></div>`).join('');
  }

  function renderOptionControl(def, optionState) {
    const value = optionState[def.key];
    if (def.kind === 'select') {
      const inner = (def.choices || []).map((choice) => `<option value="${esc(choice.value)}" ${String(value) === String(choice.value) ? 'selected' : ''}>${esc(choice.label)}</option>`).join('');
      return `<label class="epoRP-or"><div><div class="epoRP-ol">${esc(def.title)}</div><div class="epoRP-oh">${esc(def.help)}</div></div><select id="${def.id}" class="epoRP-in">${inner}</select></label>`;
    }
    return `<label class="epoRP-or"><div><div class="epoRP-ol">${esc(def.title)}</div><div class="epoRP-oh">${esc(def.help)}</div></div><input id="${def.id}" type="checkbox" ${value ? 'checked' : ''}></label>`;
  }

  function renderOptionSection(sectionKey, optionState) {
    const section = OPTION_SECTIONS.find((entry) => entry.key === sectionKey);
    if (!section) return '';
    const body = OPTION_DEFS.filter((def) => def.section === sectionKey).map((def) => renderOptionControl(def, optionState)).join('');
    return `<div class="epoRP-optsec"><div class="epoRP-optsec-h">${esc(section.title)}</div>${section.help ? `<div class="epoRP-optsec-m">${esc(section.help)}</div>` : ''}<div class="epoRP-optsec-b">${body}</div></div>`;
  }

  function parsedSourceHasContent(sourceKey, data = {}) {
    const d = data && typeof data === 'object' ? data : {};
    switch (sourceKey) {
      case 'main':
        return !!(
          normalize(d.title || '')
          || normalize(d.statusRaw || '')
          || normalize(d.filingDate || '')
          || normalize(d.applicant || '')
          || (Array.isArray(d.priorities) && d.priorities.length)
          || (Array.isArray(d.publications) && d.publications.length)
          || (Array.isArray(d.recentEvents) && d.recentEvents.length)
        );
      case 'doclist':
        return !!(Array.isArray(d.docs) && d.docs.length);
      case 'event':
        return !!(Array.isArray(d.events) && d.events.length);
      case 'family':
        return !!(Array.isArray(d.publications) && d.publications.length);
      case 'legal':
        return !!((Array.isArray(d.events) && d.events.length) || (Array.isArray(d.renewals) && d.renewals.length));
      case 'federated':
        return !!(
          normalize(d.status || '')
          || normalize(d.upMemberStates || '')
          || normalize(d.invalidationDate || '')
          || normalize(d.renewalFeesPaidUntil || '')
          || normalize(d.recordUpdated || '')
          || normalize(d.applicantProprietor || '')
          || (Array.isArray(d.states) && d.states.length)
        );
      case 'citations':
        return !!((Array.isArray(d.entries) && d.entries.length) || (Array.isArray(d.phases) && d.phases.length));
      case 'ueMain':
        return !!(normalize(d.ueStatus || '') || normalize(d.upcOptOut || '') || normalize(d.memberStates || ''));
      default:
        return !!Object.keys(d).length;
    }
  }

  function placeholderPageState(doc) {
    const page = bodyText(doc).toLowerCase();
    if (!page) return '';
    if (/no files were found|no files containing your search terms|your search terms(?:.|\n){0,120}no files|no matching files were found/.test(page)) return 'notFound';
    if (/there are no items to display|no items found|no data available|no results found/.test(page)) return 'empty';
    return '';
  }

  function classifyParsedSourceState(sourceKey, doc, data = {}) {
    const hasContent = parsedSourceHasContent(sourceKey, data);
    const placeholderState = placeholderPageState(doc);

    if (placeholderState === 'notFound' && !hasContent) {
      return {
        status: sourceKey === 'main' ? 'notFound' : 'empty',
        reason: 'placeholder-no-files',
      };
    }

    if (placeholderState === 'empty' && !hasContent) {
      return {
        status: 'empty',
        reason: 'placeholder-empty',
      };
    }

    if (!hasContent) {
      return {
        status: sourceKey === 'main' ? 'empty' : 'empty',
        reason: 'no-usable-data',
      };
    }

    return {
      status: 'ok',
      reason: placeholderState ? 'content-overrode-placeholder' : 'parsed-data',
    };
  }

  function sourceStatusCounts(caseEntry) {
    const counts = { ok: 0, empty: 0, notFound: 0, error: 0, missing: 0 };
    for (const src of SOURCES) {
      const status = String(caseEntry?.sources?.[src.key]?.status || '').toLowerCase();
      if (status === 'ok') counts.ok += 1;
      else if (status === 'empty') counts.empty += 1;
      else if (status === 'notfound') counts.notFound += 1;
      else if (status === 'error') counts.error += 1;
      else counts.missing += 1;
    }
    return counts;
  }

  function sourceStatusSummaryText(counts) {
    if ((counts.ok || 0) === SOURCES.length) return `${counts.ok} loaded`;
    const parts = [];
    if (counts.ok) parts.push(`${counts.ok} loaded`);
    if (counts.empty) parts.push(`${counts.empty} empty`);
    if (counts.notFound) parts.push(`${counts.notFound} not found`);
    if (counts.error) parts.push(`${counts.error} error`);
    if (counts.missing) parts.push(`${counts.missing} pending`);
    return parts.join(' · ') || '0 loaded';
  }

  function sourceStatusTooltip(caseEntry) {
    const sources = caseEntry?.sources || {};
    return SOURCES.map((s) => `${sourceLabel(s.key)}: ${String(sources[s.key]?.status || 'missing')}`).join('\n');
  }

  function sourceStatusLevel(counts) {
    if ((counts.error || 0) > 0) return 'bad';
    if ((counts.notFound || 0) > 0 || (counts.empty || 0) > 0) return 'warn';
    if ((counts.ok || 0) > 0 && (counts.missing || 0) === 0) return 'ok';
    return 'info';
  }

  function sourceLabel(key = '') {
    return ({
      main: 'main Register',
      doclist: 'doclist',
      event: 'event history',
      family: 'family',
      legal: 'legal status',
      federated: 'federated',
      citations: 'citations',
      ueMain: 'UE/UPC',
      upcRegistry: 'UPC registry',
      pdfDeadlines: 'PDF deadlines',
    })[key] || key;
  }

  function overviewPartialState(caseEntry) {
    const counts = sourceStatusCounts(caseEntry || {});
    const sources = caseEntry?.sources || {};
    const okSources = SOURCES.map((s) => s.key).filter((key) => String(sources[key]?.status || '').toLowerCase() === 'ok');
    const emptySources = SOURCES.map((s) => s.key).filter((key) => String(sources[key]?.status || '').toLowerCase() === 'empty');
    const mainStatus = String(sources.main?.status || '').toLowerCase();
    const mainUnavailable = mainStatus === 'empty' || mainStatus === 'notfound';
    const partial = mainUnavailable && (okSources.length > 0 || emptySources.length > 0);

    const availableText = okSources.length ? okSources.map(sourceLabel).join(', ') : '';
    const emptyText = emptySources.filter((key) => key !== 'main').map(sourceLabel).join(', ');
    let note = '';
    if (partial) {
      note = mainStatus === 'notfound'
        ? 'Main Register data is unavailable for this application number.'
        : 'Main Register data is temporarily unavailable.';
      if (availableText) note += ` Showing partial data from ${availableText}.`;
      if (emptyText) note += ` Still empty: ${emptyText}.`;
    }

    return {
      counts,
      mainStatus,
      mainUnavailable,
      partial,
      okSources,
      emptySources,
      note: normalize(note),
      summary: sourceStatusSummaryText(counts),
    };
  }

  function isFresh(src, refreshHours, config = {}) {
    const sameParser = src?.parserVersion === VERSION;
    const ageMs = Number(refreshHours || 0) * 3600000;
    const allowEmpty = !!config.allowEmpty;
    const status = String(src?.status || '').toLowerCase();
    const reusableStatuses = allowEmpty ? new Set(['ok', 'empty']) : new Set(['ok']);
    if (config.allowNotFound) reusableStatuses.add('notfound');
    if (!reusableStatuses.has(status)) return false;
    if (config.dependencyStamp != null && String(src?.dependencyStamp || '') !== String(config.dependencyStamp || '')) return false;
    return !!(sameParser && src?.fetchedAt && ageMs > 0 && Date.now() - src.fetchedAt < ageMs);
  }

  function clearDerivedCaches() {
    runtime.timelineCache = { key: '', items: [] };
    runtime.overviewCache = { key: '', model: null };
  }

  function resetRouteRuntime() {
    if (initTimer) {
      clearTimeout(initTimer);
      initTimer = null;
    }
    if (runtime.routeTimer) {
      clearTimeout(runtime.routeTimer);
      runtime.routeTimer = null;
    }
    runtime.pendingInitForce = false;
    runtime.appNo = '';
    runtime.fetchCaseNo = null;
    runtime.lastViewLogKey = '';
    clearDerivedCaches();
  }

  function scheduleInit(force = false) {
    runtime.pendingInitForce = runtime.pendingInitForce || !!force;
    if (runtime.routeTimer) clearTimeout(runtime.routeTimer);
    runtime.routeTimer = setTimeout(() => {
      runtime.routeTimer = null;
      const nextForce = runtime.pendingInitForce;
      runtime.pendingInitForce = false;
      init(nextForce);
    }, 80);
  }

  function derivedDependencyStamp(caseNo, key) {
    const c = getCase(caseNo);
    if (key === 'upcRegistry') {
      return `main:${sourceStamp(c, 'main')}|pubs:${upcCandidateNumbers(caseNo).join(',')}`;
    }
    if (key === 'pdfDeadlines') {
      return `doclist:${sourceStamp(c, 'doclist')}`;
    }
    return '';
  }

  function currentUrl() {
    return new URL(location.href);
  }

  function currentLang() {
    return currentUrl().searchParams.get('lng') || 'en';
  }

  function appNoFromDocument(doc = document) {
    const m = bodyText(doc).match(/\b(EP\d{6,12})\b/i);
    return m ? m[1].toUpperCase() : '';
  }

  function appNoFromUrl(url = currentUrl()) {
    return normalize(url.searchParams.get('number') || '').toUpperCase();
  }

  function detectAppNo(url = currentUrl(), doc = document) {
    const fromUrl = appNoFromUrl(url);
    if (/^EP\d+/i.test(fromUrl)) return fromUrl;
    const fromDom = appNoFromDocument(doc);
    return /^EP\d+/i.test(fromDom) ? fromDom : '';
  }

  function tabSlug(url = currentUrl()) {
    return normalize(url.searchParams.get('tab') || 'main');
  }

  function isCasePage(url = currentUrl()) {
    if (!/\/application$/i.test(url.pathname)) return false;
    if (url.searchParams.has('documentId')) return false;
    return /^EP\d+/i.test(appNoFromUrl(url));
  }

  function sourceUrl(caseNo, slug) {
    const u = new URL(`${location.origin}/application`);
    u.searchParams.set('number', caseNo);
    u.searchParams.set('lng', currentLang());
    u.searchParams.set('tab', slug);
    return u.toString();
  }

  function sourceTitle(key) {
    return SOURCES.find((s) => s.key === key)?.title || key;
  }

  function normalizeOptions(raw) {
    const merged = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };

    for (const def of OPTION_DEFS) {
      const key = def.key;
      if (!(key in merged)) continue;

      if (def.kind === 'checkbox') {
        const value = merged[key];
        if (typeof value === 'string') {
          const lowered = value.trim().toLowerCase();
          merged[key] = !(lowered === 'false' || lowered === '0' || lowered === 'no' || lowered === 'off' || lowered === '');
        } else {
          merged[key] = !!value;
        }
        continue;
      }

      if (def.kind === 'select') {
        const allowed = new Set((def.choices || []).map((choice) => String(choice.value || '').toLowerCase()));
        const value = String(merged[key] || DEFAULTS[key] || '').toLowerCase();
        merged[key] = allowed.has(value) ? value : DEFAULTS[key];
      }
    }

    return merged;
  }

  function options() {
    if (!optionsShadow) {
      const persisted = loadJson(OPTIONS_KEY, null);
      const sessionPersisted = loadSessionJson(`${OPTIONS_KEY}:session`, null);
      optionsShadow = normalizeOptions((persisted && typeof persisted === 'object') ? persisted : (sessionPersisted || {}));
    }
    return normalizeOptions(optionsShadow);
  }

  function setOptions(patch) {
    const next = normalizeOptions({ ...options(), ...patch });
    optionsShadow = next;
    saveJson(OPTIONS_KEY, next);
    saveSessionJson(`${OPTIONS_KEY}:session`, next);
    return next;
  }

  function uiState() {
    return loadJson(UI_KEY, { activeView: runtime.activeView, collapsed: runtime.collapsed });
  }

  function setUiState(patch) {
    const next = { ...uiState(), ...patch };
    saveJson(UI_KEY, next);
    runtime.activeView = next.activeView;
    runtime.collapsed = !!next.collapsed;
  }

  function sessionState() {
    if (!sessionShadow || typeof sessionShadow !== 'object') {
      sessionShadow = loadSessionJson(SESSION_KEY, { cases: {} });
    }
    if (!sessionShadow.cases || typeof sessionShadow.cases !== 'object') sessionShadow.cases = {};
    return sessionShadow;
  }

  function saveSessionState() {
    return saveSessionJson(SESSION_KEY, sessionState());
  }

  function getCaseSession(caseNo) {
    if (!caseNo) return {};
    const state = sessionState();
    const key = String(caseNo).toUpperCase();
    if (!state.cases[key] || typeof state.cases[key] !== 'object') state.cases[key] = {};
    return state.cases[key];
  }

  function patchCaseSession(caseNo, patch) {
    if (!caseNo || !patch || typeof patch !== 'object') return {};
    const state = sessionState();
    const key = String(caseNo).toUpperCase();
    const next = { ...(state.cases[key] || {}), ...patch, updatedAt: Date.now() };
    state.cases[key] = next;

    const keys = Object.keys(state.cases || {});
    const maxEntries = 40;
    if (keys.length > maxEntries) {
      keys
        .sort((a, b) => Number(state.cases[a]?.updatedAt || 0) - Number(state.cases[b]?.updatedAt || 0))
        .slice(0, keys.length - maxEntries)
        .forEach((k) => delete state.cases[k]);
    }

    saveSessionState();
    return next;
  }

  function timelineGroupKey(caseNo, item) {
    const topTitles = (item.items || []).slice(0, 3).map((x) => normalize(String(x?.title || ''))).join('||');
    const parts = [
      caseNo,
      item.dateStr || '',
      item.title || '',
      item.actor || '',
      topTitles,
    ];
    return parts.map((v) => normalize(String(v))).join('|');
  }

  function getDoclistOpenGroups(caseNo) {
    const byCase = uiState().doclistOpenByCase || {};
    const arr = Array.isArray(byCase[caseNo]) ? byCase[caseNo] : [];
    return new Set(arr.map((v) => String(v)));
  }

  function setDoclistOpenGroups(caseNo, groupSet) {
    const state = uiState();
    const byCase = { ...(state.doclistOpenByCase || {}) };
    byCase[caseNo] = [...groupSet].slice(0, 250);

    const keys = Object.keys(byCase);
    if (keys.length > 20) {
      const keep = new Set(keys.slice(-20));
      for (const k of keys) if (!keep.has(k)) delete byCase[k];
    }

    setUiState({ doclistOpenByCase: byCase });
  }

  function clearDoclistOpenGroups(caseNo = '') {
    const normalized = normalize(String(caseNo || ''));
    const state = uiState();
    const byCase = { ...(state.doclistOpenByCase || {}) };
    if (normalized) delete byCase[normalized];
    else {
      for (const key of Object.keys(byCase)) delete byCase[key];
    }
    setUiState({ doclistOpenByCase: byCase });
  }

  function doclistGroupKey(caseNo, bundle, ordinal = 0) {
    const parts = [caseNo, bundle || 'Group', String(ordinal || 0)];
    return parts.map((v) => normalize(String(v))).join('|');
  }

  function persistLiveDoclistGroups(caseNo) {
    if (!caseNo || tabSlug() !== 'doclist') return;
    const table = bestTable(document, ['date', 'document']) || bestTable(document, ['document type']);
    if (!table) return;

    const openGroups = getDoclistOpenGroups(caseNo);
    table.querySelectorAll('tr.epoRP-docgrp .epoRP-docgrp-btn[data-group-key]').forEach((btn) => {
      const key = String(btn.getAttribute('data-group-key') || '');
      if (!key) return;
      if (btn.getAttribute('aria-expanded') === 'true') openGroups.add(key);
      else openGroups.delete(key);
    });
    setDoclistOpenGroups(caseNo, openGroups);
  }

  function panelScrollKey(caseNo, view) {
    return `${String(caseNo || '').toUpperCase()}|${String(view || 'overview').toLowerCase()}`;
  }

  function normalizePanelScrollTop(scrollTop) {
    const top = Math.max(0, Math.round(Number(scrollTop) || 0));
    return Number.isFinite(top) ? top : 0;
  }

  function panelScrollRestoreOverride(previousCaseNo, previousView, previousScrollTop, nextCaseNo, nextView) {
    if (!previousCaseNo || !nextCaseNo) return null;
    if (String(previousCaseNo) !== String(nextCaseNo)) return null;
    if (String(previousView || 'overview') !== String(nextView || 'overview')) return null;
    return normalizePanelScrollTop(previousScrollTop);
  }

  function getPanelScroll(caseNo, view) {
    const key = panelScrollKey(caseNo, view);
    const map = uiState().panelScrollByView || {};
    const value = Number(map[key]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function setPanelScroll(caseNo, view, scrollTop) {
    if (!caseNo || !view) return;
    const key = panelScrollKey(caseNo, view);
    const state = uiState();
    const map = { ...(state.panelScrollByView || {}) };
    const top = normalizePanelScrollTop(scrollTop);
    if ((Number(map[key]) || 0) === top) return;
    map[key] = top;

    const keys = Object.keys(map);
    const maxEntries = 180;
    if (keys.length > maxEntries) {
      for (const oldKey of keys.slice(0, keys.length - maxEntries)) delete map[oldKey];
    }

    setUiState({ panelScrollByView: map });
  }

  function persistCurrentPanelScroll() {
    const b = runtime.body;
    if (!b || runtime.collapsed || !runtime.appNo) return;
    setPanelScroll(runtime.appNo, runtime.activeView || 'overview', b.scrollTop || 0);
  }

  function schedulePanelScrollSave(caseNo, view, scrollTop) {
    if (runtime.scrollSaveTimer) clearTimeout(runtime.scrollSaveTimer);
    runtime.scrollSaveTimer = setTimeout(() => {
      runtime.scrollSaveTimer = null;
      setPanelScroll(caseNo, view, scrollTop);
    }, 120);
  }

  function restorePanelScroll(caseNo, view, overrideTop = null) {
    const b = runtime.body;
    if (!b) return;
    const top = overrideTop == null ? getPanelScroll(caseNo, view) : normalizePanelScrollTop(overrideTop);
    requestAnimationFrame(() => {
      if (runtime.body !== b) return;
      if (runtime.appNo !== caseNo) return;
      if (runtime.activeView !== view) return;
      b.scrollTop = top;
    });
  }

  function scheduleRender() {
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        renderPanel();
      }, 60);
    }
  }

  function logViewContext(caseNo, view) {
    if (!caseNo || !view) return;
    const registerTab = tabSlug();
    const key = `${caseNo}|${registerTab}|${view}|${runtime.collapsed ? 'collapsed' : 'expanded'}`;
    if (runtime.lastViewLogKey === key) return;
    runtime.lastViewLogKey = key;
    addLog(caseNo, 'info', 'Sidebar context', {
      source: 'ui',
      registerTab,
      view,
      collapsed: !!runtime.collapsed,
    });
  }

  function sectionRowsByHeader(doc, headerRegex) {
    const groups = [];

    for (const tr of doc.querySelectorAll('tr')) {
      const headers = [...tr.querySelectorAll('th,td')].filter((cell) => {
        const tag = String(cell.tagName || '').toUpperCase();
        if (tag === 'TH') return true;
        const cls = String(cell.className || '').toLowerCase();
        return /\bth\b/.test(cls) || cls.includes('header');
      });
      const th = headers.find((h) => headerRegex.test(text(h)));
      if (!th) continue;

      const rows = [tr];
      const rowspan = Math.max(1, parseInt(th.getAttribute('rowspan') || '1', 10) || 1);
      let next = tr;
      for (let i = 1; i < rowspan; i++) {
        next = next?.nextElementSibling;
        if (!next || next.tagName !== 'TR') break;
        rows.push(next);
      }
      groups.push(rows);
    }

    return groups;
  }

  function sectionTextsByHeader(doc, headerRegex) {
    return dedupe(sectionRowsByHeader(doc, headerRegex).map((rows) => rows.map((r) => text(r)).join('\n').trim()).filter(Boolean), (x) => x);
  }

  function rowLabelValuePairs(row) {
    const pairs = {};
    let currentKey = '';
    for (const cell of row.querySelectorAll('th,td')) {
      const raw = normalize(text(cell));
      const tag = String(cell.tagName || '').toUpperCase();
      const cls = String(cell.className || '').toLowerCase();
      const isLabel = tag === 'TH' || /\bth\b/.test(cls) || cls.includes('header');
      if (isLabel) {
        currentKey = raw.replace(/:\s*$/, '').trim();
        if (currentKey && !(currentKey in pairs)) pairs[currentKey] = '';
        continue;
      }
      if (!currentKey) continue;
      if (raw) pairs[currentKey] = pairs[currentKey] ? `${pairs[currentKey]} ${raw}`.trim() : raw;
      currentKey = '';
    }
    return pairs;
  }

  function fieldByLabel(doc, regexes) {
    for (const row of doc.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('th,td')].map(text);
      if (cells.length < 2) continue;
      for (let i = 0; i < cells.length - 1; i++) {
        if (!regexes.some((re) => re.test(cells[i] || ''))) continue;
        const value = cells.slice(i + 1).filter(Boolean).join('\n').trim();
        if (value) return value;
      }
    }
    for (const dl of doc.querySelectorAll('dl')) {
      const children = [...dl.children];
      for (let i = 0; i < children.length; i++) {
        if (children[i]?.tagName !== 'DT') continue;
        if (!regexes.some((re) => re.test(text(children[i])))) continue;
        const values = [];
        for (let j = i + 1; j < children.length && children[j]?.tagName !== 'DT'; j++) {
          if (children[j]?.tagName === 'DD') values.push(text(children[j]));
        }
        const value = values.filter(Boolean).join('\n').trim();
        if (value) return value;
      }
    }
    return '';
  }

  function parseApplicationField(raw) {
    const m = normalize(raw).match(/(\d{6,10}\.\d)[\s\S]{0,70}?(\d{2}\.\d{2}\.\d{4})\b/);
    return { filingDate: m?.[2] || '' };
  }

  function parseMainPublications(doc, role = 'EP (this file)') {
    const out = [];

    const push = (rawNo, rawKind, rawDate) => {
      const parsed = splitPublicationNumber(rawNo, rawKind);
      const dateStr = String(rawDate || '').match(DATE_RE)?.[1] || '';
      if (!parsed.no || !dateStr) return;
      out.push({ no: parsed.no, kind: parsed.kind, dateStr, role });
    };

    for (const rows of sectionRowsByHeader(doc, /^Publication\b/i)) {
      let currentType = '';
      let currentNo = '';
      let currentDate = '';

      const flush = () => {
        if (!currentNo || !currentDate) return;
        push(currentNo, currentType, currentDate);
        currentType = '';
        currentNo = '';
        currentDate = '';
      };

      for (const row of rows) {
        const cells = [...row.querySelectorAll('th,td')].map(text).filter(Boolean);
        for (let i = 0; i < cells.length - 1; i++) {
          const label = cells[i];
          const value = cells.slice(i + 1).join(' ');
          if (/^Type:?$/i.test(label)) {
            currentType = value.match(/\b([A-Z]\d)\b/)?.[1] || currentType;
          } else if (/^No\.:?$/i.test(label)) {
            currentNo = value;
          } else if (/^Date:?$/i.test(label)) {
            currentDate = value;
            flush();
          }
        }
      }

      flush();
    }

    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function extractEpNumbersByHeader(doc, headerRegex) {
    const values = [];
    for (const chunk of sectionTextsByHeader(doc, headerRegex)) {
      for (const m of chunk.matchAll(/\b(EP\d{6,12})(?:\.\d)?\b/gi)) {
        values.push(String(m[1] || '').toUpperCase());
      }
    }
    return dedupe(values, (x) => x);
  }

  function parsePriority(raw, pageText = '') {
    const out = [];
    const rawText = dedupeMultiline(raw);
    const rawLines = String(rawText || '').split('\n').map((v) => v.trim()).filter(Boolean);

    const push = (no, dateStr) => {
      const n = String(no || '').replace(/\s+/g, '').toUpperCase();
      const d = String(dateStr || '').trim();
      if (!n || !d) return;
      out.push({ no: n, dateStr: d });
    };

    // Priority IDs are usually country-code + numeric-ish body (e.g. GB20230019788).
    const parseLine = (line, loose = false) => {
      const re = loose
        ? /\b([A-Z]{2}[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/i
        : /\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/i;
      const m = String(line || '').match(re);
      if (!m) return null;
      return { no: m[1], dateStr: m[2] };
    };

    for (const line of rawLines) {
      const parsed = parseLine(line, false) || parseLine(line, true);
      if (!parsed) continue;
      push(parsed.no, parsed.dateStr);
    }

    if (!out.length && rawText) {
      for (const m of rawText.matchAll(/\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b[\s\S]{0,120}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) {
        push(m[1], m[2]);
      }

      // Last-resort pairing for layouts where number/date are split across cells/lines.
      if (!out.length) {
        const ids = [...rawText.matchAll(/\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b/gi)].map((m) => String(m[1] || ''));
        const dates = [...rawText.matchAll(/\b(\d{2}\.\d{2}\.\d{4})\b/g)].map((m) => String(m[1] || ''));
        if (ids[0] && dates[0]) push(ids[0], dates[0]);
      }
    }

    if (!out.length && pageText) {
      const section = String(pageText).match(/Priority\s+number,\s*date([\s\S]{0,500}?)(?=\b(?:Filing language|Procedural language|Publication|Applicant|Representative|Status|Most recent event)\b|$)/i)?.[1] || '';
      for (const m of section.matchAll(/\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) {
        push(m[1], m[2]);
      }
      if (!out.length) {
        for (const m of section.matchAll(/\b([A-Z]{2}[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) {
          push(m[1], m[2]);
        }
      }
    }

    return dedupe(out, (i) => `${i.no}|${i.dateStr}`);
  }

  const CITATION_PHASE_ORDER = ['Search', 'International search', 'Examination', 'Opposition', 'Appeal', 'by applicant'];

  function normalizePublicationNumber(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function splitPublicationNumber(rawNo, rawKind = '') {
    let no = normalizePublicationNumber(rawNo);
    let kind = String(rawKind || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (kind && no.endsWith(kind) && no.length > kind.length + 5) {
      no = no.slice(0, -kind.length);
    }

    if (!kind) {
      const m = no.match(/^(.*?)([A-Z]\d)$/);
      if (m && m[1].length >= 7) {
        no = m[1];
        kind = m[2];
      }
    }

    return { no, kind };
  }

  function parsePublications(textBlock, role = '') {
    const out = [];
    const pubPrefixes = /^(?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)/;

    const push = (rawNo, rawKind, rawDate) => {
      const parsed = splitPublicationNumber(rawNo, rawKind);
      const dateStr = String(rawDate || '').match(DATE_RE)?.[1] || '';
      if (!parsed.no || !dateStr) return;
      if (!pubPrefixes.test(parsed.no)) return;
      if (!/\d/.test(parsed.no.slice(2))) return;

      out.push({ no: parsed.no, kind: parsed.kind, dateStr, role });
    };

    const text = String(textBlock || '');
    const numberPattern = '((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)(?:[\\s.\\-\\/]*[A-Z0-9]){5,18})';
    let m;

    const strictNumberBeforeDate = new RegExp(`\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\b`, 'gi');
    while ((m = strictNumberBeforeDate.exec(text)) !== null) {
      push(m[1], m[2], m[3]);
    }

    if (!out.length) {
      const strictDateBeforeNumber = new RegExp(`\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b\\s+${numberPattern}\\b(?:\\s+([A-Z]\\d))?`, 'gi');
      while ((m = strictDateBeforeNumber.exec(text)) !== null) {
        push(m[2], m[3], m[1]);
      }
    }

    if (!out.length) {
      const reNumberBeforeDate = new RegExp(`\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?[\\s\\S]{0,50}?\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b`, 'gi');
      while ((m = reNumberBeforeDate.exec(text)) !== null) {
        push(m[1], m[2], m[3]);
      }

      const reDateBeforeNumber = new RegExp(`\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b[\\s\\S]{0,50}?\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?`, 'gi');
      while ((m = reDateBeforeNumber.exec(text)) !== null) {
        push(m[2], m[3], m[1]);
      }
    }

    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function inferPublicationsFromDocs(docs = []) {
    const out = [];
    const re = /\b((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)(?:[\s.\-\/]*[A-Z0-9]){6,24})\b(?:\s+([A-Z]\d))?\b/i;
    for (const d of docs) {
      const title = String(d?.title || '');
      const procedure = String(d?.procedure || '');
      if (!/publication|published|a1|a2|a3|b1|b2|bulletin|gazette/i.test(`${title} ${procedure}`)) continue;
      const m = `${title}\n${procedure}`.match(re);
      if (!m) continue;
      const parsed = splitPublicationNumber(m[1], m[2]);
      if (!parsed.no || !/^(?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)/.test(parsed.no)) continue;
      if (!/\d/.test(parsed.no.slice(2))) continue;
      out.push({
        no: parsed.no,
        kind: parsed.kind,
        dateStr: d.dateStr || '',
        role: 'Inferred from documents',
      });
    }
    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function publicationKey(pub = {}) {
    return `${pub.no || ''}${pub.kind || ''}|${pub.dateStr || ''}|${pub.role || ''}`;
  }

  function mergePublications(...groups) {
    return dedupe(groups.flat().filter(Boolean), publicationKey).sort(compareDateDesc);
  }

  function caseSourceData(caseEntry, key, fallback = {}) {
    const data = caseEntry?.sources?.[key]?.data;
    return data == null ? fallback : data;
  }

  function caseDocs(caseEntry) {
    return [...(caseSourceData(caseEntry, 'doclist', {}).docs || [])].sort(compareDateDesc);
  }

  function casePublications(caseEntry, config = {}) {
    const main = caseSourceData(caseEntry, 'main', {});
    const family = caseSourceData(caseEntry, 'family', {});
    const docs = config.docs || caseDocs(caseEntry);
    const includeFamily = config.includeFamily !== false;
    const includeDocFallback = config.includeDocFallback !== false;
    const publicationFallback = includeDocFallback ? inferPublicationsFromDocs(docs) : [];
    return mergePublications(
      main.publications || [],
      includeFamily ? (family.publications || []) : [],
      publicationFallback,
    );
  }

  function caseSnapshot(caseNo) {
    const c = getCase(caseNo);
    const main = caseSourceData(c, 'main', {});
    const doclist = caseSourceData(c, 'doclist', {});
    const family = caseSourceData(c, 'family', {});
    const legal = caseSourceData(c, 'legal', {});
    const federated = caseSourceData(c, 'federated', {});
    const citations = caseSourceData(c, 'citations', {});
    const eventHistory = caseSourceData(c, 'event', {});
    const ue = caseSourceData(c, 'ueMain', {});
    const upcRegistry = caseSourceData(c, 'upcRegistry', null);
    const pdfDeadlines = caseSourceData(c, 'pdfDeadlines', {});
    const docs = [...(doclist.docs || [])].sort(compareDateDesc);
    const publications = casePublications(c, { docs });
    return { c, main, doclist, family, legal, federated, citations, eventHistory, ue, upcRegistry, pdfDeadlines, docs, publications };
  }

  function parseRecentEvents(raw) {
    const lines = String(raw || '').split('\n').map((v) => v.trim()).filter(Boolean);
    const out = [];
    let current = null;
    for (const line of lines) {
      const dm = line.match(/^\s*(\d{2}\.\d{2}\.\d{4})\b/);
      if (dm) {
        if (current?.dateStr && current?.title) out.push(current);
        current = { dateStr: dm[1], title: '', detail: '', source: 'Main page' };
        continue;
      }
      if (!current) continue;
      if (!current.title) current.title = line;
      else current.detail = current.detail ? `${current.detail} · ${line}` : line;
    }
    if (current?.dateStr && current?.title) out.push(current);
    return dedupe(out, (e) => `${e.dateStr}|${e.title}|${e.detail}`);
  }

  function matchStatusRule(text, rules, fallback) {
    const normalizedText = normalize(text);
    const low = normalizedText.toLowerCase();
    for (const rule of rules) {
      if (rule.test(low, normalizedText)) return typeof rule.value === 'function' ? rule.value(normalizedText, low) : rule.value;
    }
    return typeof fallback === 'function' ? fallback(normalizedText, low) : fallback;
  }

  const STATUS_STAGE_RULES = Object.freeze([
    { test: (low) => /revoked|refused|withdrawn|deemed to be withdrawn|lapsed|expired|closed/.test(low), value: 'Closed' },
    { test: (low) => /no opposition filed within time limit/.test(low), value: 'Post-grant' },
    { test: (low) => /patent has been granted|the patent has been granted|grant decision|decision to grant/.test(low), value: 'Granted' },
    { test: (low) => /grant of patent is intended|rule\s*71\(3\)|intention to grant/.test(low), value: 'R71 / grant intended' },
    { test: (low) => /article\s*94\(3\)|art\.\s*94\(3\)|examining division|request for examination was made|examination/.test(low), value: 'Examination' },
    { test: (low) => /search report|search opinion|written opinion|\bsearch\b/.test(low), value: 'Search' },
    { test: (low) => /filing/.test(low), value: 'Filing' },
    { test: (low) => /published|publication/.test(low), value: 'Post-publication' },
  ]);

  const STATUS_SUMMARY_RULES = Object.freeze([
    { test: (low) => !low, value: { simple: 'Unknown', level: 'warn' } },
    { test: (low) => /no opposition filed within time limit/.test(low), value: { simple: 'Granted (no opposition)', level: 'ok' } },
    { test: (low, raw) => /grant of patent is intended|rule\s*71\(3\)/i.test(raw), value: { simple: 'Grant intended (R71(3))', level: 'warn' } },
    { test: (low) => /patent has been granted|the patent has been granted/.test(low), value: { simple: 'Granted', level: 'ok' } },
    { test: (low) => /application deemed to be withdrawn.*non-entry into european phase/.test(low), value: { simple: 'Deemed withdrawn (non-entry)', level: 'bad' } },
    { test: (low) => /application deemed to be withdrawn.*translations of claims\/payment missing/.test(low), value: { simple: 'Deemed withdrawn (grant formalities)', level: 'bad' } },
    { test: (low) => /application deemed to be withdrawn.*non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(low), value: { simple: 'Deemed withdrawn (fees / no WO reply)', level: 'bad' } },
    { test: (low) => /application deemed to be withdrawn.*non-reply to written opinion/.test(low), value: { simple: 'Deemed withdrawn (no WO reply)', level: 'bad' } },
    { test: (low) => /deemed to be withdrawn/.test(low), value: { simple: 'Deemed withdrawn', level: 'bad' } },
    { test: (low) => /withdrawn by applicant|application withdrawn/.test(low), value: { simple: 'Withdrawn', level: 'bad' } },
    { test: (low) => /revoked|refused|expired|lapsed/.test(low), value: { simple: 'Closed', level: 'bad' } },
    { test: (low) => /application has been published|has been published/.test(low), value: { simple: 'Published', level: 'info' } },
    { test: (low) => /request for examination was made|examination/.test(low), value: { simple: 'Examination', level: 'info' } },
    { test: (low) => /search/.test(low), value: { simple: 'Search', level: 'info' } },
  ]);

  function inferStatusStage(statusRaw) {
    return matchStatusRule(statusRaw, STATUS_STAGE_RULES, '');
  }

  function summarizeStatus(raw) {
    return matchStatusRule(raw, STATUS_SUMMARY_RULES, (normalizedRaw) => {
      const oneLine = normalize(String(normalizedRaw || '').split('\n')[0] || normalizedRaw);
      return { simple: oneLine || 'Unknown', level: 'info' };
    });
  }

  function familyRoleSummary(mainData = {}) {
    const parentCase = normalize(mainData.parentCase || '').toUpperCase();
    const divisionalChildren = Array.isArray(mainData.divisionalChildren) ? mainData.divisionalChildren.filter(Boolean) : [];

    if (parentCase && divisionalChildren.length) {
      return {
        label: 'Divisional child with descendants',
        note: `Child of ${parentCase} and already parent to ${divisionalChildren.length} divisional application${divisionalChildren.length === 1 ? '' : 's'}.`,
      };
    }
    if (parentCase) {
      return {
        label: 'Divisional child',
        note: `Child of ${parentCase}.`,
      };
    }
    if (divisionalChildren.length) {
      return {
        label: 'Parent with divisionals',
        note: `${divisionalChildren.length} divisional application${divisionalChildren.length === 1 ? '' : 's'} linked from the main Register page.`,
      };
    }
    if (/divisional/i.test(String(mainData.applicationType || ''))) {
      return {
        label: 'Divisional-linked family',
        note: 'Divisional posture detected, but no explicit parent/child links were parsed from the current main page.',
      };
    }
    return {
      label: 'No explicit divisional role',
      note: '',
    };
  }

  function resolvedOverviewStatus(mainSourceStatus, statusSummary, posture) {
    if (mainSourceStatus === 'notfound') return { simple: 'Not found', level: 'bad' };
    if (mainSourceStatus === 'empty') return { simple: 'No main data', level: 'warn' };
    return {
      simple: posture?.currentLabel || statusSummary?.simple || 'Unknown',
      level: posture?.currentLevel || statusSummary?.level || 'warn',
    };
  }

  function parseApplicationType(mainData) {
    const appNo = mainData.appNo || '';
    const priorities = Array.isArray(mainData.priorities) ? mainData.priorities : [];
    const internationalAppNo = normalize(mainData.internationalAppNo || '').toUpperCase();
    const statusRaw = normalize(mainData.statusRaw || '');

    const hasExplicitPctMarker =
      /\bPCT\/[A-Z]{2}\d{4}\/\d{5,}\b/i.test(internationalAppNo)
      || /\bWO\d{4}[A-Z]{2}\d{3,}\b/i.test(internationalAppNo)
      || /\b(?:E\/PCT|EURO-?PCT|regional phase)\b/i.test(statusRaw);

    if (hasExplicitPctMarker || priorities.some((p) => /^WO\d{4}[A-Z]{2}\d{3,}$/i.test(String(p?.no || '')))) {
      return 'E/PCT regional phase';
    }
    if (mainData.isDivisional || mainData.parentCase) return 'Divisional';
    if (priorities.length > 0) return 'EP convention filing';
    if (/^EP\d+$/i.test(appNo)) return 'EP direct first filing';
    return 'Unknown';
  }

  function cleanTitle(raw) {
    const v = dedupeMultiline(raw)
      .replace(/^\s*(?:English|German|French)\s*:\s*/i, '')
      .replace(/\s*\[[^\]]+\]\s*$/g, '')
      .trim();
    return v;
  }

  function pickApplicantLine(raw) {
    const out = [];
    const lines = dedupeMultiline(raw)
      .split('\n')
      .map((line) => normalize(line))
      .filter(Boolean);

    for (let line of lines) {
      if (/^for all designated states$/i.test(line)) continue;
      if (/^\[[^\]]+\]$/.test(line)) continue;

      if (/^for all designated states\b/i.test(line)) {
        line = line.replace(/^for all designated states\b[:\s-]*/i, '').trim();
        if (!line) continue;
      }

      if (/^(applicant|for applicant)\s*[:\-]?\s*$/i.test(line)) continue;
      out.push(line);
    }

    return out[0] || '';
  }

  function formatDaysHuman(days) {
    if (!Number.isFinite(days)) return '—';
    const sign = days < 0 ? '-' : '';
    const abs = Math.abs(days);
    const years = Math.floor(abs / 365);
    const rem = abs % 365;
    if (years <= 0) return `${sign}${rem}d`;
    return `${sign}${years}y ${rem}d`;
  }

  function extractTitle(doc) {
    const rawTitle = dedupeMultiline(fieldByLabel(doc, [/^Title$/i]));
    const page = bodyText(doc);
    if (rawTitle) {
      const englishLine = rawTitle.split('\n').map((x) => x.trim()).find((line) => /^English\s*:/i.test(line));
      if (englishLine) return cleanTitle(englishLine.replace(/^English\s*:\s*/i, ''));

      const englishFromPage = page.match(/\bEnglish\s*:\s*([^\n\r\[]+)/i);
      if (englishFromPage?.[1]) return cleanTitle(englishFromPage[1]);
    }

    for (const el of [...doc.querySelectorAll('h1,h2,h3,strong,b,a')].slice(0, 120)) {
      const m = text(el).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
      if (m?.[1]) return cleanTitle(m[1]);
    }

    if (rawTitle) {
      const cleanedLines = rawTitle
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !/^(German|French)\s*:/i.test(line));
      if (cleanedLines.length) return cleanTitle(cleanedLines[0]);
    }

    const fromBody = bodyText(doc).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
    return cleanTitle(fromBody?.[1] || '');
  }

  function parseMain(doc, caseNo) {
    const appSections = sectionTextsByHeader(doc, /^Application number/i);
    const publicationSections = sectionTextsByHeader(doc, /^Publication\b/i);
    const appField = appSections[0] || fieldByLabel(doc, [/^Application number/i]);
    const statusField = dedupeMultiline(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
    const priorityField = fieldByLabel(doc, [/^Priority\b/i]);
    const publicationField = publicationSections.join('\n') || fieldByLabel(doc, [/^Publication\b/i]);
    const recentEventField = fieldByLabel(doc, [/^Most recent event$/i]);

    const appInfo = parseApplicationField(appField);
    const pageText = bodyText(doc);
    const priorities = parsePriority(priorityField, pageText);
    const status = summarizeStatus(statusField);

    const parentCandidates = extractEpNumbersByHeader(doc, /\bParent application(?:\(s\))?\b/i);
    const parentMatch = pageText.match(/\bparent\s+application(?:\(s\))?[^\n]{0,140}\b(EP\d{6,12})\b/i);
    const parentCase = parentCandidates[0] || (parentMatch ? parentMatch[1].toUpperCase() : '');

    const divisionalChildrenFromHeader = extractEpNumbersByHeader(doc, /\bDivisional application(?:\(s\))?\b/i);
    const divisionalSection = String(pageText).match(/Divisional\s+application(?:\(s\))?[\s\S]{0,400}/i)?.[0] || '';
    const divisionalChildAppsFromText = [...divisionalSection.matchAll(/\b(EP\d{8})(?:\.\d)?\b\s*(?:&nbsp;|\s)*\//gi)].map((m) => String(m[1] || '').toUpperCase());
    const divisionalChildrenFromText = [...divisionalSection.matchAll(/\b(EP\d{6,12})(?:\.\d)?\b/gi)].map((m) => String(m[1] || '').toUpperCase());
    const divisionalChildren = dedupe((divisionalChildAppsFromText.length ? divisionalChildAppsFromText : [...divisionalChildrenFromHeader, ...divisionalChildrenFromText]), (x) => x);
    const mainPublications = parseMainPublications(doc, 'EP (this file)');

    const internationalField = dedupeMultiline(fieldByLabel(doc, [/^International application\b/i, /^International publication\b/i, /^PCT application\b/i]));
    const internationalSectionFromPage = String(pageText).match(/International\s+application(?:\s+number)?[\s\S]{0,220}/i)?.[0] || '';
    const pctScopeText = `${appSections.join('\n')}\n${String(appField || '')}\n${internationalField}\n${internationalSectionFromPage}\n${pageText}`;
    const woMatch = pctScopeText.match(/\b(WO\d{4}(?:[A-Z]{2})?\d{3,})\b/i);
    const pctMatch = pctScopeText.match(/\b(PCT\/[A-Z]{2}\d{4}\/\d{5,})\b/i);
    const internationalAppNo = (woMatch?.[1] || pctMatch?.[1] || '').toUpperCase();
    const isEuroPct = !!internationalAppNo;

    const titleField = normalize(fieldByLabel(doc, [/^Title$/i]));
    const applicantField = normalize(fieldByLabel(doc, [/^Applicant/i]));
    const representativeField = normalize(fieldByLabel(doc, [/^Representative/i]));

    const fallbackApplicant = normalize((pageText.match(/\bApplicant\s*(?:\n|:)\s*([^\n]+)/i)?.[1]) || '');

    const divisionalMarker = /\bdivisional application\b/i.test(`${String(statusField || '')}\n${pageText}`);

    const result = {
      appNo: caseNo,
      title: extractTitle(doc) || cleanTitle(titleField),
      applicant: pickApplicantLine(applicantField) || normalize(applicantField.split('\n').find(Boolean) || '') || fallbackApplicant,
      representative: normalize(representativeField.split('\n').find(Boolean) || ''),
      filingDate: appInfo.filingDate,
      priorities,
      priorityText: priorities.map((p) => `${p.no} · ${p.dateStr}`).join('\n'),
      statusRaw: normalize(statusField),
      statusSimple: status.simple,
      statusLevel: status.level,
      statusStage: inferStatusStage(statusField),
      recentEvents: parseRecentEvents(recentEventField),
      publications: mainPublications.length ? mainPublications : parsePublications(publicationField, 'EP (this file)'),
      internationalAppNo,
      isEuroPct,
      isDivisional: !!parentCase || divisionalMarker,
      parentCase,
      divisionalChildren: divisionalChildren.filter((ep) => ep !== caseNo),
    };
    result.applicationType = parseApplicationType(result);
    return result;
  }

  function bestTable(doc, hints) {
    let best = null;
    let score = 0;
    for (const table of doc.querySelectorAll('table')) {
      const headerText = text(table.querySelector('thead') || table).toLowerCase();
      let s = 0;
      for (const hint of hints) if (headerText.includes(hint.toLowerCase())) s++;
      if (s > score) {
        score = s;
        best = table;
      }
    }
    return score > 0 ? best : null;
  }

  const DOCLIST_TABLE_HINT_SETS = Object.freeze([
    ['date', 'document'],
    ['document type'],
  ]);

  function doclistTable(doc) {
    for (const hints of DOCLIST_TABLE_HINT_SETS) {
      const table = bestTable(doc, hints);
      if (table) return table;
    }
    return null;
  }

  function tableColumnMap(table) {
    const map = {};
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    [...(headerRow?.querySelectorAll('th,td') || [])].map(text).forEach((h, idx) => {
      const low = h.toLowerCase();
      if (/^date$/.test(low)) map.date = idx;
      if (low.includes('document type') || low === 'document') map.document = idx;
      if (low.includes('procedure')) map.procedure = idx;
      if (low.includes('number') && low.includes('page')) map.pages = idx;
    });
    return map;
  }

  function classifyDocument(title, procedure = '') {
    const t = String(title || '').toLowerCase();
    const p = String(procedure || '').toLowerCase();

    const isSearchResponseContext =
      /search\s*\/\s*examination|search\s*and\s*examination|search report|search opinion/.test(p)
      || /after receipt of \(?(?:european\)? )?search report|before examination/.test(t);

    const isGrantContext = /rule\s*71\(3\)|intention to grant|text intended for grant|text proposed for grant|proposed for grant/.test(`${t} ${p}`);
    const isGrantCommunicationTitle = /text intended for grant|communication about intention to grant|annex to the communication about intention to grant|intention to grant/.test(t);
    const isGrantResponse = isGrantContext
      && !isGrantCommunicationTitle
      && /amend|correction|request|claims|description|translation|approval|text proposed for grant/.test(t);

    const normalizedSignal = normalizedDocSignal(title, procedure);
    if (normalizedSignal) {
      if (normalizedSignal.family === 'search') {
        return { bundle: 'Search package', level: normalizedSignal.level, actor: normalizedSignal.actor };
      }
      if (normalizedSignal.bundle === 'Intention to grant (R71(3) EPC)') {
        return { bundle: 'Grant package', level: normalizedSignal.level, actor: normalizedSignal.actor };
      }
      return { bundle: normalizedSignal.bundle, level: normalizedSignal.level, actor: normalizedSignal.actor };
    }

    const isLossOfRights = /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|communication under rule\s*112\(1\)|rule\s*112\(1\)|noting of loss of rights|application refused|application rejected/.test(`${t} ${p}`);
    if (isLossOfRights) {
      return { bundle: 'Examination', level: 'bad', actor: 'EPO' };
    }

    if (/by applicant|amendment by applicant|filed by applicant|from applicant/.test(p)) {
      if (isGrantResponse) {
        return { bundle: 'Grant package', level: 'warn', actor: 'Applicant' };
      }
      if (isSearchResponseContext && !isGrantContext && /amend|claims|description|letter|annotations|subsequently filed items/.test(t)) {
        return { bundle: 'Response to search', level: 'info', actor: 'Applicant' };
      }
      if (/request for grant|description|claims|drawings|designation of inventor|priority document|annex/.test(t)) {
        return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
      }
      return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    }

    if (/acknowledgement of receipt|receipt of electronic submission|auto-acknowledgement/.test(t) || /acknowledgement/.test(p)) {
      return { bundle: 'Other', level: 'info', actor: 'System' };
    }

    if (isGrantResponse) {
      return { bundle: 'Grant package', level: 'warn', actor: 'Applicant' };
    }

    if (isSearchResponseContext && !isGrantContext && /amend|claims|description|letter accompanying subsequently filed items|annotations|amendments received before examination/.test(t)) {
      return { bundle: 'Response to search', level: 'info', actor: 'Applicant' };
    }

    if (/amended claims filed|amendment by applicant|claims and\/or description|filed after receipt/i.test(t)) {
      return isGrantContext
        ? { bundle: 'Grant package', level: 'warn', actor: 'Applicant' }
        : { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    }

    if (/search report|search opinion|written opinion|search strategy|esr/.test(t)) return { bundle: 'Search package', level: 'info', actor: 'EPO' };
    if (/rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t)) return { bundle: 'Grant package', level: 'warn', actor: 'EPO' };
    if (/annex to (?:the )?communication|communication annex|annex.*examining division/.test(t)) {
      return /intention to grant|rule\s*71\(3\)/.test(t)
        ? { bundle: 'Grant package', level: 'warn', actor: 'EPO' }
        : { bundle: 'Examination', level: 'info', actor: 'EPO' };
    }
    if (/article\s*94\(3\)|art\.\s*94\(3\)|communication from the examining|examining division has become responsible/.test(t)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    if (/renewal|annual fee/.test(t)) return { bundle: 'Renewal', level: 'ok', actor: 'Applicant' };
    if (/request for grant|description|claims|drawings|designation of inventor|priority document/.test(t)) return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
    if (/reply|response|arguments|observations|letter|filed by applicant|submission|request/.test(t)) return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    if (/opposition|third party/.test(t) || /third party/.test(p)) return { bundle: 'Opposition', level: 'warn', actor: 'Third party' };

    if (/examining division|epo|office/.test(p)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    return { bundle: 'Other', level: 'info', actor: 'Other' };
  }

  function doclistBundleLabel(bundle) {
    if (bundle === 'Grant package' || bundle === 'Grant communication') return 'Intention to grant (R71(3) EPC)';
    if (bundle === 'Grant response') return 'Response to intention to grant';
    if (bundle === 'Examination communication') return 'Examination communication';
    if (bundle === 'Examination response') return 'Response to examination communication';
    return bundle;
  }

  function doclistEntryFromRow(row, map = {}, fallbackUrl = '', rowOrder = 0) {
    const cells = [...row.querySelectorAll('td')];
    if (!cells.length || !row.querySelector("input[type='checkbox']")) return null;
    const rowText = cells.map(text).filter(Boolean).join(' ') || text(row);
    const dm = rowText.match(DATE_RE);
    if (!dm) return null;
    const dateStr = dm[1];

    const getCell = (i) => (i != null && i < cells.length ? text(cells[i]) : '');
    let title = getCell(map.document);
    if (!title) title = [...row.querySelectorAll('a')].map(text).filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
    if (!title) return null;

    const url = [...row.querySelectorAll('a[href]')].map((a) => a.href).find(Boolean) || fallbackUrl;
    const procedure = getCell(map.procedure);
    const pages = getCell(map.pages);
    return { dateStr, title, procedure, pages, rowOrder, url, source: 'All documents' };
  }

  function parseDoclist(doc) {
    const table = doclistTable(doc);
    if (!table) return { docs: [] };
    const map = tableColumnMap(table);
    const docs = [];
    const fallbackCaseNo = runtime.fetchCaseNo || runtime.appNo || detectAppNo();
    const fallbackUrl = sourceUrl(fallbackCaseNo, 'doclist');

    let rowOrder = 0;
    for (const row of table.querySelectorAll('tr')) {
      const entry = doclistEntryFromRow(row, map, fallbackUrl, rowOrder);
      if (!entry) continue;
      rowOrder += 1;
      const cls = refineDocumentClassification(entry.title, entry.procedure, classifyDocument(entry.title, entry.procedure));
      docs.push({
        ...entry,
        ...cls,
      });
    }

    return { docs: docs.sort(compareDateDesc) };
  }

  function applyDoclistFilter(table, query) {
    const q = normalize(query).toLowerCase();
    const rows = [...table.querySelectorAll('tr')];

    for (const row of rows) {
      if (row.classList.contains('epoRP-docgrp')) continue;
      if (!row.querySelector("input[type='checkbox']")) continue;
      const txt = text(row).toLowerCase();
      row.classList.toggle('epoRP-filter-hidden', !!q && !txt.includes(q));
    }

    table.querySelectorAll('tr.epoRP-docgrp').forEach((groupHeader) => {
      const group = groupHeader.querySelector('.epoRP-docgrp-btn')?.getAttribute('data-group');
      if (!group) return;
      const groupRows = [...table.querySelectorAll(`tr[data-eporp-group='${group}']`)];
      const visibleCount = groupRows.filter((r) => !r.classList.contains('epoRP-filter-hidden')).length;
      groupHeader.classList.toggle('epoRP-filter-hidden', visibleCount === 0);
      const label = groupHeader.querySelector('.epoRP-docgrp-label');
      const meta = groupHeader.querySelector('.epoRP-docgrp-meta');
      if (label) {
        const base = label.getAttribute('data-bundle') || 'Group';
        label.textContent = base;
      }
      if (meta) {
        const count = meta.querySelector('.epoRP-docgrp-count');
        if (count) count.textContent = doclistGroupCountText(visibleCount, groupRows.length);
      }
    });
  }

  function doclistGroupingSignature(table) {
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.querySelector("input[type='checkbox']"));
    if (!rows.length) return 'empty';
    const head = rows.slice(0, 5);
    const tail = rows.slice(-5);
    const sample = [...head, ...tail].map((row) => {
      const cells = [...row.querySelectorAll('td')].map(text).filter(Boolean);
      const joined = cells.slice(0, 3).join('|');
      return normalize(joined).slice(0, 200);
    }).join('||');
    return `${rows.length}|${sample}`;
  }

  function ensureDoclistFilterWrap(table) {
    let filterWrap = document.getElementById('epoRP-doclist-filter-wrap');
    if (filterWrap) return filterWrap;

    filterWrap = document.createElement('div');
    filterWrap.id = 'epoRP-doclist-filter-wrap';
    filterWrap.className = 'epoRP-doclist-filter-wrap';
    filterWrap.innerHTML = `<input id="epoRP-doclist-filter" class="epoRP-doclist-filter" placeholder="Filter documents by name…" />`;
    table.parentElement?.insertBefore(filterWrap, table);
    filterWrap.querySelector('#epoRP-doclist-filter')?.addEventListener('input', (event) => {
      const liveTable = bestTable(document, ['date', 'document']) || bestTable(document, ['document type']);
      if (!liveTable) return;
      applyDoclistFilter(liveTable, event.target.value || '');
    });
    return filterWrap;
  }

  function resetDoclistGrouping(table) {
    table.querySelectorAll('tr.epoRP-docgrp').forEach((row) => row.remove());
    table.querySelectorAll('tr[data-eporp-group]').forEach((row) => {
      row.classList.remove('epoRP-docgrp-item', 'collapsed', 'epoRP-filter-hidden', 'epoRP-docgrp-open', 'epoRP-docgrp-last');
      row.removeAttribute('data-eporp-group');
    });
  }

  function doclistGroupingSignals(title, procedure = '') {
    const t = String(title || '').toLowerCase();
    const p = String(procedure || '').toLowerCase();
    return {
      isReceipt: /\(electronic\) receipt|acknowledgement of receipt|receipt of electronic submission|auto-acknowledgement/.test(t),
      isGrantCommunication: /communication about intention to grant|intention to grant \(signatures\)|text intended for grant|annex to the communication about intention to grant|bibliographic data of the european patent application/.test(t),
      isGrantResponseExplicit: /request for correction\/amendment of the text proposed for grant|text proposed for grant|approval of the text|disapproval of the communication of intention to grant|translation of the claim|translation of claims|grant and publication fee|grant and printing fee|fee for grant|fee for publishing|fee for printing/.test(t),
      isExamCommunication: !/reply to|response to|intention to grant|text intended for grant|text proposed for grant/.test(t) && /article\s*94\(3\)|art\.?\s*94\(3\)|communication from the examining division|despatch of a communication from the examining division|summons to oral proceedings|rule\s*116|examining division has become responsible/.test(`${t} ${p}`),
      isExamResponseExplicit: /reply to (?:a )?communication from the examining division|response to (?:a )?communication from the examining division|reply to summons|response to summons|observations in reply|arguments in reply|request for oral proceedings/.test(t),
      isSearchPackage: /^(?:communication regarding the transmission of the european search report|european search opinion|european search report|information on search strategy|copy of the international search report|partial international search report|written opinion(?: of the isa)?|isr: cited documents|copy of the international preliminary report on patentability|provisional opinion accompanying the partial search results)/.test(t),
      isSearchResponseExplicit: /amendments received before examination|amended claims filed after receipt of \(?(?:european\)? )?search report|amended description filed after receipt of \(?(?:european\)? )?search report|correction of deficiencies in written opinion\/amendment/.test(t),
      isFilingSignal: /^(?:abstract|claims|description|drawings|designation of inventor|request for grant|electronic request for grant|priority document|published international application|request for entry into the european phase|priority search results|document concerning fees and payments|confirmation of effective date of early entry)\b/.test(t),
      isApplicantAdminSignal: /submission concerning|annexes in respect of a client data request|letter accompanying subsequently filed items|result of consultation by telephone\/in person|change of applicant'?s representative|communication of amended entries concerning the representative/.test(t),
      isResponseCompanion: /reply|response|amend|claims|description|drawings|letter accompanying subsequently filed items|subsequently filed items|observations|arguments|request|translation|annotations|abstract|designation of inventor|priority document|published international application|document concerning fees and payments|priority search results|confirmation of effective date of early entry/.test(t),
    };
  }

  function doclistDateBlocks(rowModels) {
    const blocks = [];
    let current = [];
    let currentDate = '';
    for (const model of rowModels) {
      if (!current.length || model.dateStr === currentDate) {
        current.push(model);
        currentDate = model.dateStr;
        continue;
      }
      blocks.push(current);
      current = [model];
      currentDate = model.dateStr;
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  function refineDocumentClassification(title = '', procedure = '', cls = {}) {
    const t = normalize(title).toLowerCase();
    const p = normalize(procedure).toLowerCase();
    const merged = `${t} ${p}`;
    if (/reminder to observe due time limit|communication concerning the reminder|invitation pursuant to rule\s*45|communication under rule\s*112\(1\)|loss of rights|notification of forthcoming publication|transmission of the certificate|mention of grant|decision to grant|communication to designated inventor|search started|examining division becomes responsible|examination started|publication of the mention of the grant|grant of a european patent/.test(merged)) {
      return {
        bundle: /loss of rights|rule\s*112\(1\)|deemed to be withdrawn/.test(merged) ? 'Examination' : (cls.bundle || 'Other'),
        level: /loss of rights|rule\s*112\(1\)|deemed to be withdrawn/.test(merged) ? 'bad' : (cls.level || 'info'),
        actor: 'EPO',
      };
    }
    return cls;
  }

  function doclistEntryModel(entry = {}) {
    const title = String(entry.title || '');
    const procedure = String(entry.procedure || '');
    const dateStr = String(entry.dateStr || '');
    const rowText = String(entry.rowText || `${dateStr} ${title} ${procedure}`);
    const cls = refineDocumentClassification(title, procedure, classifyDocument(title, procedure));
    return {
      row: entry.row || null,
      title,
      procedure,
      dateStr,
      rowText,
      pages: String(entry.pages || ''),
      bundle: entry.bundle || cls.bundle || 'Other',
      actor: entry.actor || cls.actor || 'Other',
      url: entry.url || '',
      level: entry.level || cls.level || 'info',
      source: entry.source || 'All documents',
      signals: doclistGroupingSignals(title, procedure),
      groupKind: '',
    };
  }

  function doclistRowModels(rows) {
    const rowModels = [];
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')];
      if (!cells.length) continue;
      const title = [...row.querySelectorAll('a')].map(text).filter(Boolean).sort((a, b) => b.length - a.length)[0] || text(cells[2] || cells[1] || cells[0] || row);
      const procedure = text(cells[3] || '');
      const pages = text(cells[4] || '');
      const rowText = text(row);
      const dateStr = rowText.match(DATE_RE)?.[1] || '';
      rowModels.push(doclistEntryModel({ row, title, procedure, pages, dateStr, rowText }));
    }
    return rowModels;
  }

  function doclistDocModels(docs = []) {
    return (docs || []).map((doc) => doclistEntryModel(doc));
  }

  function normalizeGrantPackageRowModels(rowModels) {
    for (const block of doclistDateBlocks(rowModels)) {
      for (const model of block) {
        if (!/bibliographic data of the european patent application/i.test(model.title || '')) continue;
        const sameDateGrantSignals = block.some((other) => {
          if (other === model) return false;
          return /intention to grant|rule\s*71\(3\)|text intended for grant|communication about intention to grant|annex to the communication about intention to grant/i.test(other.title || '');
        });
        if (sameDateGrantSignals) model.bundle = 'Grant package';
      }
    }
    return rowModels;
  }

  function doclistBaseGroupKind(model) {
    if (model.bundle === 'Grant package') {
      return model.signals.isGrantCommunication ? 'Grant communication' : 'Grant response';
    }
    if (['Search package', 'European search package', 'Extended European search package', 'Supplementary European search package', 'International search / IPRP', 'Partial international search'].includes(model.bundle)) return 'Search package';
    if (model.bundle === 'Response to search') return 'Response to search';
    if (model.bundle === 'Filing package') return 'Filing package';
    if (model.bundle === 'Applicant filings') return 'Applicant filings';
    if (model.bundle === 'Examination') return model.signals.isExamCommunication ? 'Examination communication' : 'Examination';
    return model.bundle || 'Other';
  }

  function normalizeDoclistGroupKinds(rowModels) {
    for (const block of doclistDateBlocks(rowModels)) {
      const hasGrantCommunication = block.some((model) => model.signals.isGrantCommunication);
      const hasGrantResponse = block.some((model) => model.signals.isGrantResponseExplicit);
      const hasExamCommunication = block.some((model) => model.signals.isExamCommunication);
      const hasExamResponse = block.some((model) => model.signals.isExamResponseExplicit);
      const hasSearchPackage = block.some((model) => model.signals.isSearchPackage || ['Search package', 'European search package', 'Extended European search package', 'Supplementary European search package', 'International search / IPRP', 'Partial international search'].includes(model.bundle));
      const hasSearchResponse = block.some((model) => model.signals.isSearchResponseExplicit);
      const hasFilingPacket = block.some((model) => model.bundle === 'Filing package' || model.signals.isFilingSignal);
      const hasApplicantPacket = !hasGrantCommunication && !hasGrantResponse && !hasExamCommunication && !hasExamResponse && !hasSearchPackage && !hasSearchResponse && block.some((model) => model.bundle === 'Applicant filings' || model.signals.isApplicantAdminSignal);

      for (const model of block) {
        model.groupKind = doclistBaseGroupKind(model);

        if (hasGrantCommunication && model.signals.isGrantCommunication) {
          model.groupKind = 'Grant communication';
          continue;
        }
        if (hasGrantResponse && (model.signals.isGrantResponseExplicit || model.signals.isReceipt || (model.actor === 'Applicant' && model.signals.isResponseCompanion))) {
          model.groupKind = 'Grant response';
          continue;
        }
        if (hasExamCommunication && model.signals.isExamCommunication) {
          model.groupKind = 'Examination communication';
          continue;
        }
        if (hasExamResponse && (model.signals.isExamResponseExplicit || model.signals.isReceipt || (model.actor === 'Applicant' && model.signals.isResponseCompanion))) {
          model.groupKind = 'Examination response';
          continue;
        }
        if (hasSearchResponse && (model.signals.isReceipt || (model.actor === 'Applicant' && model.signals.isResponseCompanion))) {
          model.groupKind = 'Response to search';
          continue;
        }
        if (hasFilingPacket && !hasGrantCommunication && !hasGrantResponse && !hasExamCommunication && !hasExamResponse && !hasSearchResponse && (model.signals.isReceipt || model.signals.isFilingSignal || model.bundle === 'Filing package' || model.signals.isSearchPackage)) {
          model.groupKind = 'Filing package';
          continue;
        }
        if (hasSearchPackage && model.signals.isSearchPackage) {
          model.groupKind = 'Search package';
          continue;
        }
        if (hasApplicantPacket && (model.signals.isReceipt || model.signals.isApplicantAdminSignal || model.bundle === 'Applicant filings')) {
          model.groupKind = 'Applicant filings';
          continue;
        }
      }
    }
    return rowModels;
  }

  function doclistRuns(rowModels) {
    const runs = [];
    let run = null;
    for (const model of rowModels) {
      const kind = model.groupKind || model.bundle || 'Other';
      const runKey = `${kind}|${model.dateStr || ''}`;
      if (!run || run.key !== runKey) {
        run = { key: runKey, bundle: kind, groupKind: kind, dateStr: model.dateStr || '', rows: [model.row], models: [model] };
        runs.push(run);
      } else {
        run.rows.push(model.row);
        run.models.push(model);
      }
    }
    return runs;
  }

  function doclistRunPdfCategory(run, pdfDeadlines = {}) {
    const scanned = Array.isArray(pdfDeadlines?.scanned) ? pdfDeadlines.scanned : [];
    if (!scanned.length || !run?.models?.length) return '';

    const runDates = new Set(run.models.map((model) => normalizeDateString(model.dateStr || '')).filter(Boolean));
    const runTitles = new Set(run.models.map((model) => normalize(model.title || '').toLowerCase()).filter(Boolean));

    const exact = scanned.find((entry) => {
      const category = normalize(entry?.category || '');
      if (!category) return false;
      const entryDate = normalizeDateString(entry?.dateStr || '');
      const entryTitle = normalize(entry?.title || '').toLowerCase();
      return runDates.has(entryDate) && runTitles.has(entryTitle);
    });
    if (exact?.category) return String(exact.category);

    const sameDate = scanned.find((entry) => {
      const category = normalize(entry?.category || '');
      if (!category) return false;
      const entryDate = normalizeDateString(entry?.dateStr || '');
      return runDates.has(entryDate);
    });
    return String(sameDate?.category || '');
  }

  function pdfCategoryBundleLabel(pdfCategory = '', bundle = '') {
    const category = normalize(pdfCategory).toLowerCase();
    const kind = String(bundle || '');
    if (!category) return '';

    if (/(?:article|art\.?)\s*94\s*\(\s*3\s*\)/i.test(category)) {
      if (kind === 'Examination communication' || kind === 'Examination') return 'Art. 94(3) communication';
      if (kind === 'Examination response' || kind === 'Response to search') return 'Response to Art. 94(3) communication';
    }

    if (/rule\s*116/i.test(category)) {
      if (kind === 'Examination communication' || kind === 'Examination') return 'Rule 116 summons / communication';
      if (kind === 'Examination response') return 'Response to Rule 116 summons';
    }

    if (/rule\s*161\s*\/\s*162/i.test(category)) {
      if (kind === 'Search package' || kind === 'Examination communication' || kind === 'Examination') return 'Rule 161/162 communication';
      if (kind === 'Response to search' || kind === 'Examination response') return 'Response to Rule 161/162 communication';
    }

    if (/rule\s*70\s*\(\s*2\s*\)/i.test(category)) {
      if (kind === 'Search package') return 'Rule 70(2) / search communication';
      if (kind === 'Response to search') return 'Response to Rule 70(2) communication';
    }

    if (/communication response period/.test(category)) {
      if (kind === 'Examination communication' || kind === 'Examination') return 'Examination communication';
      if (kind === 'Examination response') return 'Response to examination communication';
    }

    return '';
  }

  function docSignalFromCodexRecord(record, title = '', procedure = '') {
    if (!record) return null;
    const t = normalize(title).toLowerCase();
    const p = normalize(procedure).toLowerCase();
    const actor = /third party/.test(`${t} ${p}`) || /opposition/.test(`${t} ${p}`) ? 'Third party' : 'EPO';

    switch (record.internalKey) {
      case 'GRANT_R71_3':
      case 'GRANT_R71_3_EVENT':
        return { family: 'grant', bundle: 'Intention to grant (R71(3) EPC)', actor: 'EPO', level: 'warn', reason: 'codex grant-intended event' };
      case 'FURTHER_PROCESSING_REQUEST':
      case 'FURTHER_PROCESSING_DECISION':
        return { family: 'remedial', bundle: 'Further processing', actor: 'EPO', level: 'warn', reason: 'codex remedial event' };
      case 'NO_OPPOSITION_FILED':
        return { family: 'opposition', bundle: 'Opposition', actor: 'EPO', level: 'warn', reason: 'codex opposition-end status' };
      case 'LOSS_OF_RIGHTS_EVENT':
      case 'APPLICATION_DEEMED_WITHDRAWN':
        return { family: 'loss_of_rights', bundle: 'Loss-of-rights communication', actor: 'EPO', level: 'bad', reason: 'codex loss-of-rights event' };
      default:
        break;
    }

    if (record.phase === 'hearing') {
      return { family: 'hearing', bundle: 'Oral proceedings', actor, level: 'warn', reason: 'codex hearing-phase event' };
    }
    if (record.phase === 'opposition' || record.phase === 'opposition_end') {
      return { family: 'opposition', bundle: 'Opposition', actor, level: 'warn', reason: 'codex opposition-phase event' };
    }
    if (record.phase === 'remedial') {
      return { family: 'remedial', bundle: 'Further processing', actor: 'EPO', level: 'warn', reason: 'codex remedial-phase event' };
    }
    if (record.phase === 'loss_of_rights') {
      return { family: 'loss_of_rights', bundle: 'Loss-of-rights communication', actor: 'EPO', level: 'bad', reason: 'codex loss-of-rights phase' };
    }
    if (record.phase === 'grant') {
      return {
        family: 'grant',
        bundle: record.classification === 'deadline-bearing' ? 'Intention to grant (R71(3) EPC)' : 'Grant decision',
        actor: 'EPO',
        level: record.classification === 'deadline-bearing' ? 'warn' : 'ok',
        reason: 'codex grant-phase event',
      };
    }
    if (record.phase === 'search') {
      return { family: 'search', bundle: 'Search package', actor: 'EPO', level: 'info', reason: 'codex search-phase event' };
    }
    return null;
  }

  const NORMALIZED_DOC_SIGNAL_RULES = Object.freeze([
    { test: (t) => /decision to allow further processing/.test(t), signal: { family: 'remedial', bundle: 'Further processing', actor: 'EPO', level: 'warn', reason: 'further-processing decision' } },
    { test: (t) => /decision to grant a european patent/.test(t), signal: { family: 'grant', bundle: 'Grant decision', actor: 'EPO', level: 'ok', reason: 'grant decision' } },
    { test: (t) => /transmission of the certificate for a european patent pursuant to rule\s*74/.test(t), signal: { family: 'post_grant', bundle: 'Patent certificate', actor: 'EPO', level: 'ok', reason: 'rule-74 certificate' } },
    { test: (t) => /grant of extension of time limit/.test(t), signal: { family: 'remedial', bundle: 'Extension of time limit', actor: 'EPO', level: 'info', reason: 'extension of time limit' } },
    { test: (t) => /application deemed to be withdrawn.*non-entry into european phase/.test(t), signal: { family: 'loss_of_rights', bundle: 'Euro-PCT non-entry failure', actor: 'EPO', level: 'bad', reason: 'non-entry into EP phase' } },
    { test: (t) => /application deemed to be withdrawn.*translations of claims\/payment missing/.test(t), signal: { family: 'loss_of_rights', bundle: 'Grant-formalities failure', actor: 'EPO', level: 'bad', reason: 'grant formalities missing' } },
    { test: (t) => /application deemed to be withdrawn.*non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(t), signal: { family: 'loss_of_rights', bundle: 'Fees / written-opinion failure', actor: 'EPO', level: 'bad', reason: 'fees plus written-opinion failure' } },
    { test: (t) => /application deemed to be withdrawn.*non-reply to written opinion/.test(t), signal: { family: 'loss_of_rights', bundle: 'Written-opinion loss', actor: 'EPO', level: 'bad', reason: 'written opinion not answered' } },
    { test: (t) => /loss of rights|rule\s*112\(1\)/.test(t), signal: { family: 'loss_of_rights', bundle: 'Loss-of-rights communication', actor: 'EPO', level: 'bad', reason: 'rule 112 / loss-of-rights notice' } },
    { test: (t) => /document annexed to the extended european search report|extended european search report/.test(t), signal: { family: 'search', bundle: 'Extended European search package', actor: 'EPO', level: 'info', reason: 'extended search report annex' } },
    { test: (t) => /supplementary european search report/.test(t), signal: { family: 'search', bundle: 'Supplementary European search package', actor: 'EPO', level: 'info', reason: 'supplementary ESR' } },
    { test: (t) => /international preliminary report on patentability|written opinion of the isa|isr: cited documents/.test(t), signal: { family: 'search', bundle: 'International search / IPRP', actor: 'EPO', level: 'info', reason: 'IPRP / ISA packet' } },
    { test: (t) => /partial international search report|provisional opinion accompanying the partial search results/.test(t), signal: { family: 'search', bundle: 'Partial international search', actor: 'EPO', level: 'info', reason: 'partial ISR packet' } },
    { test: (t) => /communication regarding the transmission of the european search report|european search opinion|european search report|information on search strategy/.test(t), signal: { family: 'search', bundle: 'European search package', actor: 'EPO', level: 'info', reason: 'European search packet' } },
    { test: (t) => /rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t), signal: { family: 'grant', bundle: 'Intention to grant (R71(3) EPC)', actor: 'EPO', level: 'warn', reason: 'R71 / grant-intended packet' } },
    { test: (t) => /oral proceedings|summons to oral proceedings/.test(t), signal: { family: 'hearing', bundle: 'Oral proceedings', actor: 'EPO', level: 'warn', reason: 'oral proceedings event' } },
    { test: (t, p) => /opposition|third party/.test(t) || /third party/.test(p), signal: { family: 'opposition', bundle: 'Opposition', actor: 'Third party', level: 'warn', reason: 'opposition / third-party filing' } },
  ]);

  function normalizedDocSignalFromRules(title = '', procedure = '') {
    const t = normalize(title).toLowerCase();
    const p = normalize(procedure).toLowerCase();
    for (const rule of NORMALIZED_DOC_SIGNAL_RULES) {
      if (rule.test(t, p)) return { ...rule.signal };
    }
    return null;
  }

  function normalizedDocSignal(title = '', procedure = '') {
    const codexSignal = docSignalFromCodexRecord(codexDescriptionRecord(title), title, procedure);
    if (codexSignal) return codexSignal;
    return normalizedDocSignalFromRules(title, procedure);
  }

  const PACKET_SIGNAL_PRECEDENCE = Object.freeze([
    'Euro-PCT non-entry failure',
    'Grant-formalities failure',
    'Fees / written-opinion failure',
    'Written-opinion loss',
    'Loss-of-rights communication',
    'Further processing',
    'Grant decision',
    'Patent certificate',
    'Extension of time limit',
    'Extended European search package',
    'Supplementary European search package',
    'International search / IPRP',
    'Partial international search',
    'European search package',
    'Intention to grant (R71(3) EPC)',
    'Opposition',
    'Oral proceedings',
    'Search package',
  ]);

  const STANDALONE_PACKET_BUNDLES = new Set([
    'Further processing',
    'Grant decision',
    'Patent certificate',
    'Extension of time limit',
    'Euro-PCT non-entry failure',
    'Grant-formalities failure',
    'Fees / written-opinion failure',
    'Written-opinion loss',
    'Loss-of-rights communication',
    'Opposition',
    'Oral proceedings',
  ]);

  function packetSignalBundle(signal) {
    return signal?.bundle || '';
  }

  function standalonePacketBundle(signal) {
    const bundle = packetSignalBundle(signal);
    return STANDALONE_PACKET_BUNDLES.has(bundle) ? bundle : '';
  }

  function normalizedPacketSignal(models = []) {
    const signals = (models || [])
      .map((model) => normalizedDocSignal(model?.title || '', model?.procedure || ''))
      .filter(Boolean);

    if (!signals.length) return null;

    for (const bundle of PACKET_SIGNAL_PRECEDENCE) {
      const match = signals.find((signal) => signal.bundle === bundle);
      if (match) return { ...match, source: 'normalized-packet-signal' };
    }

    return { ...signals[0], source: 'normalized-packet-signal' };
  }

  function searchRunLabel(run) {
    const bundle = String(run?.bundle || run?.groupKind || 'Other');
    if (bundle !== 'Search package') return '';
    const signal = normalizedPacketSignal(run?.models || []);
    return signal?.family === 'search' ? signal.bundle : '';
  }

  function specialRunLabel(run) {
    return standalonePacketBundle(normalizedPacketSignal(run?.models || []));
  }

  function doclistRunLabel(run, pdfDeadlines = {}) {
    const bundle = String(run?.bundle || run?.groupKind || 'Other');
    const base = doclistBundleLabel(bundle);
    const titles = (run?.models || []).map((model) => normalize(model.title || '').toLowerCase()).filter(Boolean).join('\n');
    const pdfCategory = normalize(doclistRunPdfCategory(run, pdfDeadlines));

    if (bundle === 'Applicant filings') {
      if (/transfer of rights|registering a transfer/.test(titles)) return 'Transfer / recordal filings';
      if (/representative/.test(titles)) return 'Representative change filings';
      if (/client data request|consultation by telephone\/in person/.test(titles)) return 'Register admin filings';
      if (/reply to the invitation to remedy deficiencies|invitation to remedy deficiencies/.test(titles)) return 'Filing-deficiency response';
      return specialRunLabel(run) || base;
    }

    return pdfCategoryBundleLabel(pdfCategory, bundle) || searchRunLabel(run) || specialRunLabel(run) || base;
  }

  function doclistPageTotal(run) {
    return (run?.models || []).reduce((sum, model) => sum + (Number(String(model?.pages || '').match(/\d+/)?.[0] || 0) || 0), 0);
  }

  function doclistGroupCountText(visibleCount, totalCount) {
    if (!totalCount) return '0 items';
    if (visibleCount == null || visibleCount === totalCount) return `${totalCount} item${totalCount === 1 ? '' : 's'}`;
    return `${visibleCount} of ${totalCount} items`;
  }

  function doclistGroupSummaryHtml(run, visibleCount = null, explanation = '') {
    const totalCount = Number(run?.rows?.length || 0);
    const totalPages = doclistPageTotal(run);
    const countText = doclistGroupCountText(visibleCount, totalCount);
    const pagesText = totalPages > 0 ? `${totalPages} page${totalPages === 1 ? '' : 's'}` : '';
    return `<span class="epoRP-docgrp-meta"${explanation ? ` title="${esc(explanation)}"` : ''}><span class="epoRP-docgrp-count">${esc(countText)}</span>${pagesText ? `<span class="epoRP-docgrp-sep">·</span><span class="epoRP-docgrp-pages">${esc(pagesText)}</span>` : ''}</span>`;
  }

  function attachDoclistGroupRun(caseNo, run, gid, openGroups, hasSavedOpenState, pdfDeadlines = {}) {
    const groupId = `g${gid}`;
    const groupKey = doclistGroupKey(caseNo, run.bundle, gid);
    const defaultOpen = !!options().doclistGroupsExpandedByDefault;
    const isOpen = hasSavedOpenState ? openGroups.has(groupKey) : defaultOpen;
    if (!hasSavedOpenState && defaultOpen) openGroups.add(groupKey);
    const firstRow = run.rows[0];
    const cells = [...firstRow.querySelectorAll('td')];

    const headerRow = document.createElement('tr');
    headerRow.className = 'epoRP-docgrp';
    headerRow.classList.toggle('open', isOpen);

    const td = document.createElement('td');
    td.colSpan = Math.max(1, cells.length);
    const bundleLabel = doclistRunLabel(run, pdfDeadlines);
    const bundleExplanation = docPacketExplanation(bundleLabel);
    td.innerHTML = `<div class="epoRP-docgrp-head"><label class="epoRP-docgrp-sel" title="Select all items in this group" aria-label="Select all items in this group"><input type="checkbox" class="epoRP-docgrp-check" data-group="${groupId}" data-group-key="${esc(groupKey)}"></label><button type="button" class="epoRP-docgrp-btn" data-group="${groupId}" data-group-key="${esc(groupKey)}" aria-expanded="${isOpen ? 'true' : 'false'}" ${bundleExplanation ? `title="${esc(bundleExplanation)}"` : ''}><span class="epoRP-docgrp-main"><span class="epoRP-docgrp-label" data-bundle="${esc(bundleLabel)}">${esc(bundleLabel)}</span>${doclistGroupSummaryHtml(run, null, bundleExplanation)}</span><span class="epoRP-docgrp-arrow">▸</span></button></div>`;
    headerRow.appendChild(td);
    firstRow.parentElement?.insertBefore(headerRow, firstRow);

    const rowCheckboxes = [];
    run.rows.forEach((row, idx) => {
      row.setAttribute('data-eporp-group', groupId);
      row.classList.add('epoRP-docgrp-item');
      row.classList.toggle('collapsed', !isOpen);
      row.classList.toggle('epoRP-docgrp-open', isOpen);
      row.classList.toggle('epoRP-docgrp-last', idx === run.rows.length - 1);
      const cb = row.querySelector("input[type='checkbox']");
      if (cb) rowCheckboxes.push(cb);
    });

    const button = td.querySelector('button.epoRP-docgrp-btn');
    const headerCheckbox = td.querySelector('input.epoRP-docgrp-check');

    const syncHeaderCheckbox = () => {
      if (!headerCheckbox || !rowCheckboxes.length) return;
      const checked = rowCheckboxes.filter((cb) => !!cb.checked).length;
      headerCheckbox.indeterminate = checked > 0 && checked < rowCheckboxes.length;
      headerCheckbox.checked = checked > 0 && checked === rowCheckboxes.length;
    };

    if (button) {
      button.addEventListener('click', (event) => {
        const btn = event.currentTarget;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !expanded;
        btn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        headerRow.classList.toggle('open', nextExpanded);
        for (const row of run.rows) {
          row.classList.toggle('collapsed', !nextExpanded);
          row.classList.toggle('epoRP-docgrp-open', nextExpanded);
        }
        if (nextExpanded) openGroups.add(groupKey);
        else openGroups.delete(groupKey);
        if (caseNo) setDoclistOpenGroups(caseNo, openGroups);
      });
    }

    if (headerCheckbox) {
      headerCheckbox.addEventListener('change', () => {
        const shouldCheck = !!headerCheckbox.checked;
        for (const cb of rowCheckboxes) {
          if (cb.checked === shouldCheck) continue;
          cb.checked = shouldCheck;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncHeaderCheckbox();
      });
    }

    rowCheckboxes.forEach((cb) => cb.addEventListener('change', syncHeaderCheckbox));
    syncHeaderCheckbox();
  }

  function enhanceDoclistGrouping() {
    if (tabSlug() !== 'doclist') return;

    const caseNo = detectAppNo() || runtime.appNo || '';
    const table = bestTable(document, ['date', 'document']) || bestTable(document, ['document type']);
    if (!table) return;

    const filterWrap = ensureDoclistFilterWrap(table);
    const currentQuery = (filterWrap.querySelector('#epoRP-doclist-filter')?.value || '');
    const signature = doclistGroupingSignature(table);

    if (runtime.doclistGroupSigByCase[caseNo] === signature && table.querySelector('tr.epoRP-docgrp')) {
      applyDoclistFilter(table, currentQuery);
      return;
    }

    persistLiveDoclistGroups(caseNo);
    const openGroups = getDoclistOpenGroups(caseNo);
    const doclistOpenByCase = uiState().doclistOpenByCase || {};
    const hasSavedOpenState = Array.isArray(doclistOpenByCase[caseNo]);

    resetDoclistGrouping(table);

    const rows = [...table.querySelectorAll('tr')].filter((row) => row.querySelector("input[type='checkbox']"));
    const groupable = new Set(['Search package', 'Grant communication', 'Grant response', 'Examination communication', 'Examination response', 'Examination', 'Filing package', 'Applicant filings', 'Response to search']);
    const pdfDeadlines = caseSourceData(getCase(caseNo), 'pdfDeadlines', {});
    const runs = doclistRuns(normalizeDoclistGroupKinds(normalizeGrantPackageRowModels(doclistRowModels(rows))));

    let gid = 0;
    for (const run of runs) {
      if (!groupable.has(run.bundle) || run.rows.length < 2) continue;
      gid += 1;
      attachDoclistGroupRun(caseNo, run, gid, openGroups, hasSavedOpenState, pdfDeadlines);
    }

    runtime.doclistGroupSigByCase[caseNo] = signature;
    applyDoclistFilter(table, currentQuery);
  }


  function parseDatedRows(doc, url) {
    const rows = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('th,td')].map(text).filter(Boolean);
      if (cells.length < 2) continue;
      const dateCell = cells.find((v) => DATE_RE.test(v));
      if (!dateCell) continue;
      const dateStr = dateCell.match(DATE_RE)[1];
      let payload = cells.filter((value, idx) => {
        if (idx === 0 && DATE_RE.test(value)) return false;
        return !/^(date|event|status|publication|document|document type)$/i.test(value);
      });
      if (!payload[0]) continue;
      if (/^event\s*date\s*:?$/i.test(payload[0]) && payload[1]) payload = payload.slice(1);
      if (!payload[0] || /^\d{2}\.\d{2}\.\d{4}$/.test(payload[0])) continue;
      rows.push({ dateStr, title: payload[0], detail: payload.slice(1).join(' · '), url });
    }
    return dedupe(rows, (r) => `${r.dateStr}|${r.title}|${r.detail}`).sort(compareDateDesc);
  }

  function normalizeCodexDescription(value = '') {
    return normalize(value).toLowerCase();
  }

  function legalCodeRecord(code) {
    return code ? (EPO_CODEX_DATA.byCode[String(code).toUpperCase()] || null) : null;
  }

  function codexDescriptionRecord(description) {
    const key = normalizeCodexDescription(description);
    return key ? (EPO_CODEX_DATA.byDescription[key] || null) : null;
  }

  function normalizeCodexSignal(raw = {}) {
    const sourceCode = normalize(raw.sourceCode || '').toUpperCase();
    const sourceDescription = normalize(raw.sourceDescription || '');
    const exact = legalCodeRecord(sourceCode);
    if (exact) return { ...raw, matchStrategy: 'exact-code', codexRecord: exact };
    const fallback = codexDescriptionRecord(sourceDescription);
    if (fallback) return { ...raw, matchStrategy: 'description-fallback', codexRecord: fallback };
    return { ...raw, matchStrategy: 'unmapped', codexRecord: null };
  }

  function extractLegalEventBlocks(doc, url) {
    const blocks = [];
    let current = null;

    const pushCurrent = () => {
      if (!current) return;
      if (!current.codexKey && current.title) {
        const matched = normalizeCodexSignal({ sourceDescription: current.title });
        current.matchStrategy = current.matchStrategy || matched.matchStrategy;
        if (matched.codexRecord) {
          current.codexKey = matched.codexRecord.internalKey;
          current.codexPhase = matched.codexRecord.phase;
          current.codexClass = matched.codexRecord.classification;
        }
      }
      if (current.dateStr || current.title || current.detail) blocks.push(current);
      current = null;
    };

    for (const row of doc.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('th,td')].map(text).filter(Boolean);
      if (!cells.length) continue;
      const label = cells[0];
      const value = normalize(cells.slice(1).join(' · '));

      if (/^Event date:?$/i.test(label) && DATE_RE.test(value)) {
        pushCurrent();
        current = {
          dateStr: value.match(DATE_RE)?.[1] || '',
          title: '',
          detail: '',
          url,
          freeFormatText: '',
          effectiveDate: '',
          originalCode: '',
          codexKey: '',
          codexPhase: '',
          codexClass: '',
        };
        continue;
      }

      if (!current) continue;
      if (/^Event description:?$/i.test(label)) {
        current.title = value;
        continue;
      }
      if (/^Free Format Text:?$/i.test(label)) {
        current.freeFormatText = value;
        current.detail = current.detail ? `${current.detail} · ${value}` : value;
        const originalCode = normalize(value.match(/ORIGINAL CODE:\s*([A-Z0-9]+)/i)?.[1] || '').toUpperCase();
        const matched = normalizeCodexSignal({ sourceCode: originalCode, sourceDescription: current.title || value });
        if (originalCode) current.originalCode = originalCode;
        current.matchStrategy = matched.matchStrategy;
        if (matched.codexRecord) {
          current.codexKey = matched.codexRecord.internalKey;
          current.codexPhase = matched.codexRecord.phase;
          current.codexClass = matched.codexRecord.classification;
        }
        continue;
      }
      if (/^Effective DATE:?$/i.test(label)) {
        current.effectiveDate = value;
        current.detail = current.detail ? `${current.detail} · Effective DATE ${value}` : `Effective DATE ${value}`;
        continue;
      }
      if (/^Event description:?$/i.test(label)) continue;
      if (/^Original code:?$/i.test(label)) {
        const originalCode = value.toUpperCase();
        const matched = normalizeCodexSignal({ sourceCode: originalCode, sourceDescription: current.title || current.detail || value });
        current.originalCode = originalCode;
        current.matchStrategy = matched.matchStrategy;
        if (matched.codexRecord) {
          current.codexKey = matched.codexRecord.internalKey;
          current.codexPhase = matched.codexRecord.phase;
          current.codexClass = matched.codexRecord.classification;
        }
        continue;
      }
    }

    pushCurrent();
    return dedupe(blocks, (event) => `${event.dateStr}|${event.title}|${event.detail}|${event.originalCode}`).sort(compareDateDesc);
  }

  function parseFamily(doc) {
    const publications = [];
    const rows = [...doc.querySelectorAll('tr')];
    let inPublicationBlock = false;

    for (const row of rows) {
      const cells = [...row.querySelectorAll('td,th')].map((cell) => normalize(text(cell)));
      if (!cells.length) continue;

      if (/^publication no\.?$/i.test(cells[0] || '')) {
        inPublicationBlock = true;
        continue;
      }
      if (/^priority number$/i.test(cells[0] || '')) {
        inPublicationBlock = false;
        continue;
      }
      if (!inPublicationBlock) continue;
      if (!/^(?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)/i.test(cells[0] || '')) continue;

      const dateStr = cells.find((value) => DATE_RE.test(value || '')) || '';
      const kind = cells.find((value) => /^[A-Z]\d?$/.test(value || '')) || '';
      const parsed = splitPublicationNumber(cells[0], kind);
      if (!parsed.no || !dateStr) continue;
      publications.push({ no: parsed.no, kind: parsed.kind, dateStr: dateStr.match(DATE_RE)?.[1] || '', role: 'Family' });
    }

    return {
      publications: publications.length
        ? dedupe(publications, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`)
        : parsePublications(bodyText(doc), 'Family'),
    };
  }

  function parseLegal(doc, caseNo) {
    const events = parseDatedRows(doc, sourceUrl(caseNo, 'legal'));
    const codedEvents = extractLegalEventBlocks(doc, sourceUrl(caseNo, 'legal'));
    const renewals = [];
    for (const e of events) {
      const low = `${e.title} ${e.detail}`.toLowerCase();
      if (!/renewal|annual fee|year\s*\d+/.test(low)) continue;
      const ym = low.match(/year\s*(\d+)/i) || low.match(/(\d+)(?:st|nd|rd|th)\s*year/i);
      renewals.push({ dateStr: e.dateStr, title: e.title, detail: e.detail, year: ym ? +ym[1] : null });
    }
    return { events, codedEvents, renewals: renewals.sort(compareDateDesc) };
  }

  function parseEventHistory(doc, caseNo) {
    const events = parseDatedRows(doc, sourceUrl(caseNo, 'event')).map((event) => {
      const matched = normalizeCodexSignal({ sourceDescription: event.title || '' });
      if (!matched.codexRecord) return event;
      return {
        ...event,
        codexKey: matched.codexRecord.internalKey,
        codexPhase: matched.codexRecord.phase,
        codexClass: matched.codexRecord.classification,
        matchStrategy: matched.matchStrategy,
      };
    });
    return { events };
  }

  function parseUe(doc) {
    const pageText = bodyText(doc);
    const status = normalize(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
    let ueStatus = '';
    let upcOptOut = '';

    if (/unitary effect registered|registered as a unitary patent/i.test(pageText)) ueStatus = 'Unitary effect registered';
    else if (/request.*unitary effect|unitary effect.*request/i.test(pageText)) ueStatus = 'UE requested';
    else if (status) ueStatus = status;

    if (/opt[\s-]*out.*registered|opted[\s-]*out/i.test(pageText)) upcOptOut = 'Opted out';
    else if (/opt[\s-]*out.*withdrawn|opt[\s-]*out.*removed/i.test(pageText)) upcOptOut = 'Opt-out withdrawn';
    else if (/no\s*opt[\s-]*out|not\s*opted/i.test(pageText)) upcOptOut = 'No opt-out';

    return {
      statusRaw: status,
      ueStatus,
      upcOptOut,
      memberStates: normalize(fieldByLabel(doc, [/^Member State/i, /^Participating/i, /^Designated/i])),
      text: pageText,
    };
  }

  function parseFederated(doc, caseNo) {
    const states = [];
    const summary = {
      appNo: caseNo,
      fullPublicationNo: '',
      applicantProprietor: '',
      status: '',
      upMemberStates: '',
      invalidationDate: '',
      renewalFeesPaidUntil: '',
      recordUpdated: '',
    };

    const captureSummary = (pairs) => {
      if (!summary.appNo && pairs['EP application number']) summary.appNo = pairs['EP application number'];
      if (!summary.fullPublicationNo && pairs['Full publication number']) summary.fullPublicationNo = pairs['Full publication number'];
      if (!summary.applicantProprietor && pairs['Applicant / proprietor']) summary.applicantProprietor = pairs['Applicant / proprietor'];
      if (!summary.status && pairs.Status) summary.status = pairs.Status;
      if (!summary.upMemberStates && pairs['Member States covered by Unitary Patent Protection']) summary.upMemberStates = pairs['Member States covered by Unitary Patent Protection'];
      if (!summary.invalidationDate && pairs['Invalidation date']) summary.invalidationDate = pairs['Invalidation date'];
      if (!summary.renewalFeesPaidUntil && pairs['Renewal fees paid until']) summary.renewalFeesPaidUntil = pairs['Renewal fees paid until'];
      if (!summary.recordUpdated && pairs['Record last updated']) summary.recordUpdated = pairs['Record last updated'];
    };

    for (const row of doc.querySelectorAll('tr')) {
      const pairs = rowLabelValuePairs(row);
      if (Object.keys(pairs).length < 1) continue;
      captureSummary(pairs);
      if (!pairs.State) continue;
      states.push({
        state: pairs.State,
        nationalPublicationNo: pairs['National publication number'] || '',
        publicationDate: pairs['Publication date'] || '',
        upMemberStates: pairs['Member States covered by Unitary Patent Protection'] || '',
        invalidationDate: pairs['Invalidation date'] || '',
        renewalFeesPaidUntil: pairs['Renewal fees paid until'] || '',
        recordUpdated: pairs['Record last updated'] || '',
        notInForceSince: pairs['Not in force since'] || '',
        status: pairs.Status || summary.status || '',
      });
    }

    return {
      ...summary,
      states,
      notableStates: states.filter((s) => normalize(s.notInForceSince || '') || /lapse|revok|terminated|not in force/i.test(`${s.status || ''} ${s.nationalPublicationNo || ''}`)),
    };
  }

  function parseCitations(doc) {
    const entries = [];
    let phase = '';
    let currentType = '';

    for (const row of doc.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('th,td')].map((cell) => normalize(text(cell))).filter(Boolean);
      if (!cells.length) continue;

      if (/^Cited in$/i.test(cells[0] || '') && cells[1]) {
        phase = cells[1];
        continue;
      }
      if (/^Type:?$/i.test(cells[0] || '')) {
        currentType = cells[1] || '';
        continue;
      }
      if (!/^Publication No\.:?$/i.test(cells[0] || '')) continue;

      const raw = cells.slice(1).join(' ');
      const pubMatch = raw.match(/\b((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)\d{4,})\b/i);
      if (!pubMatch?.[1]) continue;
      const categoryMatches = [...raw.matchAll(/\[([A-Z]{1,4})\]/g)].map((m) => String(m[1] || ''));
      const applicant = raw.match(/\(([^)]+)\)/)?.[1] || '';
      entries.push({
        phase: phase || 'Other',
        type: currentType || 'Patent literature',
        publicationNo: String(pubMatch[1] || '').toUpperCase(),
        categories: dedupe(categoryMatches, (x) => x),
        applicant,
        detail: raw,
      });
    }

    const byPhase = {};
    for (const entry of entries) {
      (byPhase[entry.phase] ||= []).push(entry);
    }
    const phases = Object.keys(byPhase).sort((a, b) => {
      const ai = CITATION_PHASE_ORDER.indexOf(a);
      const bi = CITATION_PHASE_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    }).map((name) => ({ name, entries: byPhase[name] }));

    return { entries, phases };
  }

  function parseSource(key, doc, caseNo) {
    switch (key) {
      case 'main': return parseMain(doc, caseNo);
      case 'doclist': return parseDoclist(doc);
      case 'event': return parseEventHistory(doc, caseNo);
      case 'family': return parseFamily(doc);
      case 'legal': return parseLegal(doc, caseNo);
      case 'federated': return parseFederated(doc, caseNo);
      case 'citations': return parseCitations(doc);
      case 'ueMain': return parseUe(doc);
      default: return {};
    }
  }

  function sourceDiagnostics(sourceKey, data) {
    const d = data && typeof data === 'object' ? data : {};
    if (sourceKey === 'main') {
      return {
        source: sourceKey,
        titlePresent: !!normalize(d.title || ''),
        priorities: Array.isArray(d.priorities) ? d.priorities.length : 0,
        publications: Array.isArray(d.publications) ? d.publications.length : 0,
        recentEvents: Array.isArray(d.recentEvents) ? d.recentEvents.length : 0,
        status: d.statusSimple || 'Unknown',
      };
    }
    if (sourceKey === 'doclist') {
      return {
        source: sourceKey,
        docs: Array.isArray(d.docs) ? d.docs.length : 0,
      };
    }
    if (sourceKey === 'event') {
      return {
        source: sourceKey,
        events: Array.isArray(d.events) ? d.events.length : 0,
      };
    }
    if (sourceKey === 'family') {
      return {
        source: sourceKey,
        publications: Array.isArray(d.publications) ? d.publications.length : 0,
      };
    }
    if (sourceKey === 'legal') {
      return {
        source: sourceKey,
        events: Array.isArray(d.events) ? d.events.length : 0,
        renewals: Array.isArray(d.renewals) ? d.renewals.length : 0,
      };
    }
    if (sourceKey === 'federated') {
      return {
        source: sourceKey,
        status: d.status || '',
        states: Array.isArray(d.states) ? d.states.length : 0,
        upMemberStates: normalize(d.upMemberStates || '').split(/,\s*/).filter(Boolean).length,
      };
    }
    if (sourceKey === 'citations') {
      return {
        source: sourceKey,
        entries: Array.isArray(d.entries) ? d.entries.length : 0,
        phases: Array.isArray(d.phases) ? d.phases.length : 0,
      };
    }
    if (sourceKey === 'ueMain') {
      return {
        source: sourceKey,
        ueStatus: d.ueStatus || '',
        upcOptOut: d.upcOptOut || '',
      };
    }
    return { source: sourceKey };
  }

  function captureLiveSource(caseNo) {
    const sourceKey = SOURCES.find((s) => s.slug === tabSlug())?.key;
    if (!sourceKey) return;
    try {
      const data = parseSource(sourceKey, document, caseNo);
      const classified = classifyParsedSourceState(sourceKey, document, data);
      const parseMessage = classified.status === 'ok'
        ? 'Live parse success'
        : classified.status === 'notFound'
          ? 'Live parse result not found'
          : 'Live parse result empty';
      const parseLevel = classified.status === 'ok' ? 'info' : classified.status === 'notFound' ? 'warn' : 'info';
      addLog(caseNo, parseLevel, parseMessage, { transport: 'dom', status: classified.status, reason: classified.reason, ...sourceDiagnostics(sourceKey, data) });
      storeCaseSource(caseNo, sourceKey, {
        status: classified.status,
        url: location.href,
        transport: 'dom',
        data,
      });
    } catch (error) {
      addLog(caseNo, 'error', `Live parse failure: ${error?.message || error}`, { source: sourceKey, transport: 'dom' });
      storeCaseSource(caseNo, sourceKey, {
        status: 'error',
        url: location.href,
        transport: 'dom',
        error: String(error?.message || error),
      });
    }
  }

  async function fetchWithTimeout(url, signal, responseType = 'text') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return responseType === 'arrayBuffer'
        ? await response.arrayBuffer()
        : await response.text();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function loadExternalScriptText(url, signal) {
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('GM_xmlhttpRequest unavailable'));
    return new Promise((resolve, reject) => {
      const req = GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: FETCH_TIMEOUT_MS * 2,
        onload: (res) => {
          if (res.status >= 200 && res.status < 400) resolve(String(res.responseText || ''));
          else reject(new Error(`HTTP ${res.status}`));
        },
        onerror: () => reject(new Error(`Failed to load script: ${url}`)),
        ontimeout: () => reject(new Error(`Timed out loading script: ${url}`)),
      });
      const onAbort = () => {
        try { req?.abort?.(); } catch {}
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function loadExternalScriptTag(url, signal) {
    return new Promise((resolve, reject) => {
      const root = document.head || document.documentElement || document.body;
      if (!root) {
        reject(new Error('Document root unavailable for script injection'));
        return;
      }

      const script = document.createElement('script');
      script.async = true;
      script.src = url;
      script.crossOrigin = 'anonymous';

      let settled = false;
      const cleanup = () => {
        script.onload = null;
        script.onerror = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const settle = (error = null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          try { script.remove(); } catch {}
          reject(error);
          return;
        }
        resolve();
      };

      const timeout = setTimeout(() => settle(new Error(`Timed out loading script tag: ${url}`)), FETCH_TIMEOUT_MS * 2);
      const onAbort = () => settle(new DOMException('Aborted', 'AbortError'));

      script.onload = () => {
        clearTimeout(timeout);
        settle();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        settle(new Error(`Failed to load script tag: ${url}`));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      root.appendChild(script);
    });
  }

  function getUnsafeWindow() {
    try {
      return typeof unsafeWindow !== 'undefined' ? unsafeWindow : null;
    } catch {
      return null;
    }
  }

  function libraryGlobalHolders() {
    const uw = getUnsafeWindow();
    return [window, globalThis, uw].filter(Boolean);
  }

  function normalizeLibraryGlobalNames(names) {
    return Array.isArray(names) ? names.filter(Boolean) : [names].filter(Boolean);
  }

  function getNamedGlobal(names, validator) {
    for (const holder of libraryGlobalHolders()) {
      for (const name of normalizeLibraryGlobalNames(names)) {
        const lib = holder?.[name];
        if (validator(lib)) return lib;
      }
    }
    return null;
  }

  function clearInvalidNamedGlobals(names, validator) {
    for (const holder of libraryGlobalHolders()) {
      for (const name of normalizeLibraryGlobalNames(names)) {
        const lib = holder?.[name];
        if (!lib || validator(lib)) continue;
        try { delete holder[name]; } catch { holder[name] = undefined; }
      }
    }
  }

  function registerNamedGlobal(names, lib, validator) {
    if (!validator(lib)) return null;
    for (const holder of libraryGlobalHolders()) {
      for (const name of normalizeLibraryGlobalNames(names)) {
        try { holder[name] = lib; } catch {}
      }
    }
    return lib;
  }

  function evaluateNamedLibraryCode(code, label, { names, validator, moduleResolver, globalLabel = 'library' } = {}) {
    const source = `${String(code || '')}
//# sourceURL=${label}.js`;
    let lastError = null;

    const existing = getNamedGlobal(names, validator);
    if (existing) return existing;

    try {
      // eslint-disable-next-line no-new-func
      const commonJsRunner = new Function('window', 'globalThis', 'self', `${source}
return (typeof module !== 'undefined' && module && module.exports) ? module.exports : null;`);
      const mod = commonJsRunner(window, globalThis, self);
      const lib = moduleResolver?.(mod) || (validator(mod) ? mod : null);
      if (validator(lib)) return registerNamedGlobal(names, lib, validator);
    } catch (error) {
      lastError = error;
    }

    try {
      // eslint-disable-next-line no-new-func
      Function(source)();
    } catch (error) {
      lastError = error;
    }

    const afterFunction = getNamedGlobal(names, validator);
    if (afterFunction) return registerNamedGlobal(names, afterFunction, validator);

    try {
      // eslint-disable-next-line no-eval
      (0, eval)(source);
    } catch (error) {
      lastError = error;
    }

    const afterEval = getNamedGlobal(names, validator);
    if (afterEval) return registerNamedGlobal(names, afterEval, validator);

    try {
      const root = document.head || document.documentElement || document.body;
      if (!root) throw new Error('Document root unavailable for inline script evaluation');
      const script = document.createElement('script');
      script.textContent = source;
      root.appendChild(script);
      script.remove();
    } catch (error) {
      lastError = error;
    }

    const afterInlineScript = getNamedGlobal(names, validator);
    if (afterInlineScript) return registerNamedGlobal(names, afterInlineScript, validator);
    if (lastError) throw lastError;
    throw new Error(`Script evaluated but ${globalLabel} global/module was not exposed`);
  }

  async function ensureNamedLibrary(signal, {
    promiseKey,
    candidates,
    names,
    validator,
    moduleResolver,
    minLength = 0,
    labelPrefix = 'external-library',
    displayName = 'library',
    onReady = null,
  } = {}) {
    const existing = getNamedGlobal(names, validator);
    if (existing) return existing;
    if (runtime[promiseKey]) return runtime[promiseKey];

    runtime[promiseKey] = (async () => {
      const errors = [];

      for (const candidate of candidates || []) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        clearInvalidNamedGlobals(names, validator);

        try {
          const code = await loadExternalScriptText(candidate.lib, signal);
          const head = String(code || '').slice(0, 400);
          if (!code || code.length < minLength || /<html|<!doctype/i.test(head)) {
            throw new Error('non-script payload received');
          }
          const lib = evaluateNamedLibraryCode(code, `${labelPrefix}-${candidate.id}-text`, { names, validator, moduleResolver, globalLabel: displayName });
          if (!validator(lib)) throw new Error(`${displayName} global not available after text load/eval`);
          if (typeof onReady === 'function') onReady(lib, candidate);
          return registerNamedGlobal(names, lib, validator);
        } catch (error) {
          errors.push(`${candidate.id}/text: ${error?.message || error}`);
        }

        try {
          await loadExternalScriptTag(candidate.lib, signal);
          const lib = getNamedGlobal(names, validator);
          if (!validator(lib)) throw new Error(`${displayName} global not available after script-tag load`);
          if (typeof onReady === 'function') onReady(lib, candidate);
          return registerNamedGlobal(names, lib, validator);
        } catch (error) {
          errors.push(`${candidate.id}/tag: ${error?.message || error}`);
        }
      }

      throw new Error(`${displayName} load failed (${errors.join(' | ') || 'unknown error'})`);
    })().catch((error) => {
      runtime[promiseKey] = null;
      throw error;
    });

    return runtime[promiseKey];
  }

  function isPdfJsLibrary(lib) {
    return !!(lib && typeof lib.getDocument === 'function');
  }

  function resolvePdfJsModule(mod) {
    return isPdfJsLibrary(mod)
      ? mod
      : isPdfJsLibrary(mod?.pdfjsLib)
        ? mod.pdfjsLib
        : null;
  }

  function getPdfJsGlobal() {
    return getNamedGlobal(['pdfjsLib', 'pdfjs-dist/build/pdf'], isPdfJsLibrary);
  }

  async function ensurePdfJs(signal) {
    return ensureNamedLibrary(signal, {
      promiseKey: 'pdfjsPromise',
      candidates: PDF_JS_CANDIDATES,
      names: ['pdfjsLib', 'pdfjs-dist/build/pdf'],
      validator: isPdfJsLibrary,
      moduleResolver: resolvePdfJsModule,
      minLength: 1000,
      labelPrefix: 'eporp-pdfjs',
      displayName: 'pdf.js',
      onReady: (lib, candidate) => {
        lib.GlobalWorkerOptions.workerSrc = candidate.worker;
      },
    });
  }

  function isTesseractLibrary(lib) {
    return !!(lib && typeof lib.recognize === 'function');
  }

  function resolveTesseractModule(mod) {
    return isTesseractLibrary(mod)
      ? mod
      : isTesseractLibrary(mod?.Tesseract)
        ? mod.Tesseract
        : null;
  }

  function getTesseractGlobal() {
    return getNamedGlobal(['Tesseract'], isTesseractLibrary);
  }

  async function ensureTesseract(signal) {
    return ensureNamedLibrary(signal, {
      promiseKey: 'tesseractPromise',
      candidates: OCR_TESSERACT_CANDIDATES,
      names: ['Tesseract'],
      validator: isTesseractLibrary,
      moduleResolver: resolveTesseractModule,
      minLength: 900,
      labelPrefix: 'eporp-tesseract',
      displayName: 'Tesseract',
    });
  }

  function fetchCrossOrigin(url, signal) {
    if (typeof GM_xmlhttpRequest !== 'function') return fetchWithRetry(url, signal);
    return new Promise((resolve, reject) => {
      const req = GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: FETCH_TIMEOUT_MS,
        onload: (res) => {
          if (res.status >= 200 && res.status < 400) resolve(String(res.responseText || ''));
          else reject(new Error(`HTTP ${res.status}`));
        },
        onerror: () => reject(new Error('Cross-origin request failed')),
        ontimeout: () => reject(new Error('Cross-origin request timed out')),
      });

      const onAbort = () => {
        try { req?.abort?.(); } catch {}
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function parseUpcOptOutResult(html, patentNumber) {
    const t = normalize((html || '').replace(/<[^>]+>/g, ' ')).toLowerCase();
    if (!t) return null;
    if (/no results found/.test(t)) {
      return { patentNumber, optedOut: false, status: 'No opt-out found', source: 'UPC registry' };
    }

    const pn = String(patentNumber || '').toLowerCase();
    const hasPatentRef = pn && t.includes(pn);
    if (!hasPatentRef) return null;

    const hasOptOutToken = /\bopt(?:ed)?[\s-]*out\b/.test(t);
    const positiveSignal =
      /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+(?:register(?:ed)?|enter(?:ed)?|effective)\b/.test(t)
      || /\b(?:register(?:ed)?|enter(?:ed)?|effective)(?:\s+\w+){0,8}\s+opt(?:ed)?[\s-]*out\b/.test(t)
      || /\bcase\s+type\s+opt(?:ed)?[\s-]*out\s+application\b/.test(t)
      || /\bopt(?:ed)?[\s-]*out\s+application\b/.test(t);
    const withdrawnSignal = /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+(?:withdrawn|removed|revoked)\b/.test(t);
    const negativeSignal =
      /\bnot\s+opt(?:ed)?[\s-]*out\b/.test(t)
      || /\bno\s+opt(?:ed)?[\s-]*out\b/.test(t)
      || /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+not\s+(?:been\s+)?(?:register(?:ed)?|enter(?:ed)?|effective)\b/.test(t);

    if (withdrawnSignal) {
      return { patentNumber, optedOut: false, status: 'Opt-out withdrawn', source: 'UPC registry' };
    }

    if (hasOptOutToken && positiveSignal && !negativeSignal) {
      return { patentNumber, optedOut: true, status: 'Opted out', source: 'UPC registry' };
    }

    return null;
  }

  function upcCandidateNumbers(caseNo) {
    const { c, docs } = caseSnapshot(caseNo);
    const picks = [];

    // Use case-specific publication numbers only (avoid family-wide false positives).
    // IMPORTANT: UPC patent_number must be a publication number, never an EP application number.
    // Prefer explicit main-page publications, then supplement from case-local doclist evidence.
    for (const p of casePublications(c, { docs, includeFamily: false })) {
      const m = String(p.no || '').toUpperCase().match(/^(EP\d{6,})/);
      if (m?.[1]) picks.push(m[1]);
    }

    return [...new Set(picks)].slice(0, 4);
  }

  async function refreshUpcRegistry(caseNo, signal, force = false) {
    const dependencyStamp = derivedDependencyStamp(caseNo, 'upcRegistry');
    const cached = getCase(caseNo).sources.upcRegistry;
    if (!force && isFresh(cached, options().refreshHours, { allowEmpty: true, dependencyStamp })) return;

    const candidates = upcCandidateNumbers(caseNo);
    if (!candidates.length) {
      storeCaseSource(caseNo, 'upcRegistry', {
        title: 'UPC Opt-out registry',
        status: 'empty',
        transport: 'cross-origin',
        dependencyStamp,
        data: { patentNumbers: [], status: 'No EP publication numbers available' },
      });
      addLog(caseNo, 'info', 'UPC registry check skipped: no EP publication numbers available', { source: 'upcRegistry' });
      return;
    }

    let hadResponse = false;
    let lastError = null;

    for (const patentNumber of candidates) {
      const url = `https://www.unifiedpatentcourt.org/en/registry/opt-out/results?patent_number=${encodeURIComponent(patentNumber)}`;
      try {
        const html = await fetchCrossOrigin(url, signal);
        hadResponse = true;
        const parsed = parseUpcOptOutResult(html, patentNumber);
        if (!parsed) continue;
        storeCaseSource(caseNo, 'upcRegistry', {
          title: 'UPC Opt-out registry',
          status: 'ok',
          url,
          transport: 'cross-origin',
          dependencyStamp,
          data: parsed,
        });
        addLog(caseNo, 'ok', `UPC registry check: ${parsed.status}`, { source: 'upcRegistry', patentNumber });
        return;
      } catch (error) {
        lastError = error;
        addLog(caseNo, 'warn', `UPC registry check failed for ${patentNumber}: ${error?.message || error}`, { source: 'upcRegistry' });
      }
    }

    if (hadResponse) {
      storeCaseSource(caseNo, 'upcRegistry', {
        title: 'UPC Opt-out registry',
        status: 'empty',
        transport: 'cross-origin',
        dependencyStamp,
        data: { patentNumbers: candidates, status: 'No registry match found' },
      });
      addLog(caseNo, 'info', 'UPC registry check completed without a matching opt-out result', {
        source: 'upcRegistry',
        candidates,
      });
      return;
    }

    storeCaseSource(caseNo, 'upcRegistry', {
      title: 'UPC Opt-out registry',
      status: 'error',
      transport: 'cross-origin',
      dependencyStamp,
      error: String(lastError?.message || lastError || 'UPC registry lookup failed'),
      data: { patentNumbers: candidates },
    });
    addLog(caseNo, 'error', 'UPC registry check failed for all publication candidates', {
      source: 'upcRegistry',
      candidates,
    });
  }

  function normalizeDateString(raw) {
    const t = String(raw || '').trim();
    if (!t) return '';
    const m = t.match(/(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})/);
    if (!m) return '';
    const d = String(m[1] || '').padStart(2, '0');
    const mo = String(m[2] || '').padStart(2, '0');
    const yRaw = String(m[3] || '');
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${d}.${mo}.${y}`;
  }

  function parseSmallNumberToken(token) {
    const t = String(token || '').trim().toLowerCase();
    if (!t) return 0;
    if (/^\d{1,2}$/.test(t)) return Number(t);
    const map = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
    };
    return map[t] || 0;
  }

  function extractExplicitDeadlineDateFromPdf(textBlock) {
    const textRaw = String(textBlock || '');
    if (!textRaw) return { dateStr: '', evidence: '' };

    const candidates = [];
    const push = (rawDate, evidence, score = 100) => {
      const dateStr = normalizeDateString(rawDate);
      if (!dateStr) return;
      candidates.push({ dateStr, evidence, score });
    };

    for (const m of textRaw.matchAll(/(?:\bfinal\s+date\b[\s\S]{0,32}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit final date found in PDF communication text', 130);
    }
    for (const m of textRaw.matchAll(/(?:\bdeadline\b[\s\S]{0,32}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit deadline date found in PDF communication text', 120);
    }
    for (const m of textRaw.matchAll(/(?:\btime\s+limit\s+(?:expires?|expiring|ending)\b[\s\S]{0,24}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit time-limit expiry date found in PDF communication text', 125);
    }
    for (const m of textRaw.matchAll(/(?:\bno\s+later\s+than\b|\bat\s+the\s+latest(?:\s+by|\s+on)?\b|\blatest\s+by\b)\s*(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit latest-by date found in PDF communication text', 135);
    }

    if (!candidates.length) return { dateStr: '', evidence: '' };

    const best = candidates
      .map((c) => ({ ...c, ts: parseDateString(c.dateStr)?.getTime() || 0 }))
      .sort((a, b) => (b.score - a.score) || (b.ts - a.ts))[0];

    return { dateStr: best?.dateStr || '', evidence: best?.evidence || '' };
  }

  function extractCommunicationDateFromPdf(textBlock, context = {}) {
    const textRaw = String(textBlock || '');
    const docDateStr = normalizeDateString(context.docDateStr || '');
    const candidates = [];

    const push = (rawDate, score, evidence, contextText = '') => {
      const dateStr = normalizeDateString(rawDate);
      if (!dateStr) return;
      const veto = /final\s+date|deadline|latest\s+by|no\s+later\s+than|time\s+limit\s+(?:expires?|expiring|ending)/i;
      if (veto.test(contextText || '')) return;
      candidates.push({ dateStr, score, evidence });
    };

    // Common letter header table: Application No. / Ref. / Date
    for (const m of textRaw.matchAll(/application\s*no\.?[\s\S]{0,120}?\bref\.?[\s\S]{0,80}?\bdate\b[^\d]{0,16}(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 185, 'Date extracted from Application/Ref/Date header table in PDF');
    }

    for (const m of textRaw.matchAll(/(?:date\s+of\s+(?:this\s+)?(?:communication|notification|letter)[\s\S]{0,20}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 180, 'Date of communication field found in PDF');
    }

    for (const m of textRaw.matchAll(/\bdate\b\s*[:\-]?\s*(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      const idx = m.index || 0;
      const snippet = textRaw.slice(Math.max(0, idx - 24), Math.min(textRaw.length, idx + String(m[0] || '').length + 24));
      push(m[1], 150, 'Date field found in PDF communication header', snippet);
    }

    for (const m of textRaw.matchAll(/(?:communication(?:\s+pursuant\s+to[^\n]{0,40})?[^\n]{0,80}?\bdated\b[^\d]{0,12})(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 145, 'Dated communication line found in PDF');
    }

    const registered = extractRegisteredLetterProofLine(textRaw);
    const proofDate = normalizeDateString(String(registered.proofLine || '').match(DATE_RE)?.[1] || '');
    if (proofDate) {
      push(proofDate, 105, 'Date extracted from line below "Registered Letter" in PDF (dispatch proof context)');
    }

    const registeredLineDate = normalizeDateString(String(registered.registeredLetterLine || '').match(DATE_RE)?.[1] || '');
    if (registeredLineDate) {
      push(registeredLineDate, 95, 'Date extracted from "Registered Letter" line in PDF (dispatch proof context)');
    }

    for (const m of textRaw.matchAll(/epo\s*form[^\n\r]{0,80}\((\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})\)/gi)) {
      push(m[1], 100, 'Date extracted from EPO form stamp near Registered Letter (dispatch proof context)');
    }

    if (docDateStr) {
      push(docDateStr, 30, 'Doclist date fallback for communication date');
    }

    if (!candidates.length) return { dateStr: '', evidence: '' };

    const best = candidates
      .map((c) => ({
        ...c,
        bonus: docDateStr && c.dateStr === docDateStr ? 8 : 0,
        ts: parseDateString(c.dateStr)?.getTime() || 0,
      }))
      .sort((a, b) => ((b.score + b.bonus) - (a.score + a.bonus)) || (b.ts - a.ts))[0];

    return { dateStr: best?.dateStr || '', evidence: best?.evidence || '' };
  }

  function extractResponseMonthsFromPdf(textBlock) {
    const textRaw = String(textBlock || '');
    if (!textRaw) return { months: 0, evidence: '' };

    const candidates = [];
    const push = (token, evidence, score) => {
      const months = parseSmallNumberToken(token);
      if (!Number.isFinite(months) || months <= 0 || months > 24) return;
      candidates.push({ months, evidence, score });
    };

    for (const m of textRaw.matchAll(/\bwithin\s+(?:a\s+)?(?:period|time\s+limit)\s+of\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from "${String(m[0] || '').trim()}" in PDF text`, 130);
    }
    for (const m of textRaw.matchAll(/\b(?:period|time\s+limit)\s+of\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from "${String(m[0] || '').trim()}" in PDF text`, 120);
    }
    for (const m of textRaw.matchAll(/\bwithin\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from "${String(m[0] || '').trim()}" in PDF text`, 110);
    }
    for (const m of textRaw.matchAll(/\bof\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from fragmented phrase "${String(m[0] || '').trim()}" in PDF text`, 70);
    }

    // OCR/fragmented fallback phrases that often surface as short "X months" snippets.
    for (const m of textRaw.matchAll(/\b((?:2|3|5|6|two|three|five|six))\s+months?\b/gi)) {
      push(m[1], `Derived from fragmented target phrase "${String(m[0] || '').trim()}" in PDF text`, 62);
    }
    for (const m of textRaw.matchAll(/\bmonths?\s*(?:of|:|-)?\s*((?:2|3|5|6|two|three|five|six))\b/gi)) {
      push(m[1], `Derived from reversed fragmented target phrase "${String(m[0] || '').trim()}" in PDF text`, 58);
    }

    if (!candidates.length) return { months: 0, evidence: '' };

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    return { months: best?.months || 0, evidence: best?.evidence || '' };
  }

  function extractRegisteredLetterProofLine(textBlock) {
    const raw = String(textBlock || '');
    if (!raw) return { registeredLetterLine: '', proofLine: '' };

    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalize(line))
      .filter(Boolean);

    const idx = lines.findIndex((line) => /\bregistered\s+letter\b/i.test(line));
    if (idx >= 0) {
      const current = lines[idx] || '';
      const tail = normalize(current.replace(/.*?\bregistered\s+letter\b[:\s\-]*/i, ''));
      if (tail && !/\bregistered\s+letter\b/i.test(tail)) {
        return {
          registeredLetterLine: current,
          proofLine: tail.slice(0, 180),
        };
      }

      for (let i = idx + 1; i < Math.min(lines.length, idx + 10); i++) {
        const line = normalize(lines[i]);
        if (!line) continue;
        if (/\bregistered\s+letter\b/i.test(line)) continue;
        return {
          registeredLetterLine: current,
          proofLine: line,
        };
      }

      for (let i = Math.max(0, idx - 4); i < idx; i++) {
        const line = normalize(lines[i]);
        if (!line) continue;
        if (/\bregistered\s+letter\b/i.test(line)) continue;
        if (/\bepo\s*form\b|\(\d{2}\.\d{2}\.\d{4}\)/i.test(line)) {
          return {
            registeredLetterLine: current,
            proofLine: line,
          };
        }
      }

      return {
        registeredLetterLine: current,
        proofLine: '',
      };
    }

    const inline = normalize(raw).match(/registered\s+letter\s*[:\-]?\s*([^\n\r]{3,180})/i);
    if (inline?.[1]) {
      const proof = normalize(String(inline[1] || '').split(/\s{2,}/)[0]);
      if (proof) {
        return {
          registeredLetterLine: 'Registered Letter',
          proofLine: proof,
        };
      }
    }

    const nearby = normalize(raw).match(/(epo\s*form[^\n\r]{0,140}\(\d{2}\.\d{2}\.\d{4}\))/i);
    if (nearby?.[1]) {
      return {
        registeredLetterLine: 'Registered Letter',
        proofLine: normalize(nearby[1]),
      };
    }

    return { registeredLetterLine: '', proofLine: '' };
  }

  function inferDeadlineCategoryFromContext(context = {}) {
    const low = `${String(context.docTitle || '')} ${String(context.docProcedure || '')}`.toLowerCase();
    if (!normalize(low)) return { category: '', evidence: '' };

    if (/rule\s*71\s*\(\s*3\s*\)|intention to grant|text intended for grant/.test(low)) {
      return { category: 'R71(3) response period', evidence: 'Inferred from document title/procedure metadata (Rule 71(3) / intention to grant signal)' };
    }
    if (/\brule\s*116\b|summons to oral proceedings/.test(low)) {
      return { category: 'Rule 116 final date', evidence: 'Inferred from document title/procedure metadata (Rule 116 / summons signal)' };
    }
    if (/\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)|communication from (?:the )?examining|examining division/.test(low)) {
      return { category: 'Art. 94(3) response period', evidence: 'Inferred from document title/procedure metadata (examining-division communication signal)' };
    }
    if (/\brule\s*161\b|\brule\s*162\b/.test(low)) {
      return { category: 'Rule 161/162 response period', evidence: 'Inferred from document title/procedure metadata (Rule 161/162 signal)' };
    }
    if (/\bcommunication\b|\bnotification\b|\bsummons\b|\binvitation\b|\bofficial communication\b|\boffice action\b/.test(low)) {
      return { category: 'Communication response period', evidence: 'Inferred from document title/procedure metadata (generic communication signal)' };
    }

    return { category: '', evidence: '' };
  }

  function defaultResponseMonthsForCategory(category) {
    const c = String(category || '').toLowerCase();
    if (c.includes('art. 94(3)')) return 4;
    if (c.includes('r71(3)')) return 4;
    if (c.includes('rule 161/162')) return 6;
    return 0;
  }

  function parsePdfDeadlineHints(pdfText, context = {}) {
    const textRaw = String(pdfText || '');
    const textLower = textRaw.toLowerCase();
    const docDateStr = normalizeDateString(context.docDateStr || '');

    const diagnostics = {
      category: '',
      categoryEvidence: '',
      communicationDate: '',
      communicationEvidence: '',
      responseMonths: 0,
      responseEvidence: '',
      explicitDeadlineDate: '',
      explicitDeadlineEvidence: '',
      registeredLetterLine: '',
      registeredLetterProofLine: '',
    };

    if (!textLower) return { hints: [], diagnostics };

    const hints = [];

    const pushHint = (hint) => {
      const date = parseDateString(hint?.dateStr || '');
      if (!date) return;
      hints.push({
        label: hint.label,
        dateStr: formatDate(date),
        sourceDate: hint.sourceDate || '',
        confidence: hint.confidence || 'high',
        level: hint.level || 'bad',
        resolved: false,
        source: 'PDF parse',
        evidence: hint.evidence || '',
      });
    };

    const categoryFromText = /rule\s*71\s*\(\s*3\s*\)|intention to grant/.test(textLower)
      ? 'R71(3) response period'
      : /\brule\s*116\b|summons to oral proceedings/.test(textLower)
        ? 'Rule 116 final date'
        : /\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)/.test(textLower)
          ? 'Art. 94(3) response period'
          : /\brule\s*161\b|\brule\s*162\b/.test(textLower)
            ? 'Rule 161/162 response period'
            : '';

    const categoryFromContext = inferDeadlineCategoryFromContext(context);
    let category = categoryFromText || categoryFromContext.category;

    diagnostics.category = category;
    diagnostics.categoryEvidence = categoryFromText
      ? 'Detected from communication text'
      : (categoryFromContext.evidence || '');

    const registeredLetter = extractRegisteredLetterProofLine(textRaw);
    diagnostics.registeredLetterLine = registeredLetter.registeredLetterLine || '';
    diagnostics.registeredLetterProofLine = registeredLetter.proofLine || '';

    const communication = extractCommunicationDateFromPdf(textRaw, { docDateStr });
    const communicationDateStr = communication.dateStr || docDateStr;
    const communicationDate = parseDateString(communicationDateStr);
    diagnostics.communicationDate = communicationDateStr || '';
    diagnostics.communicationEvidence = communication.evidence || (docDateStr ? 'Doclist date fallback for communication date' : '');

    const monthPeriod = extractResponseMonthsFromPdf(textRaw);
    let responseMonths = monthPeriod.months || 0;
    let responseEvidence = monthPeriod.evidence || '';
    if (!responseMonths && category) {
      const fallbackMonths = defaultResponseMonthsForCategory(category);
      if (fallbackMonths > 0) {
        responseMonths = fallbackMonths;
        responseEvidence = `Default ${fallbackMonths}-month period inferred for ${category}${diagnostics.categoryEvidence ? ` (${diagnostics.categoryEvidence})` : ''}`;
      }
    }

    diagnostics.responseMonths = responseMonths;
    diagnostics.responseEvidence = responseEvidence;

    const explicitDue = extractExplicitDeadlineDateFromPdf(textRaw);
    diagnostics.explicitDeadlineDate = explicitDue.dateStr || '';
    diagnostics.explicitDeadlineEvidence = explicitDue.evidence || '';

    const genericCommunicationSignal = /\bcommunication\b|\bnotification\b|\bsummons\b|\binvitation\b/.test(textLower);
    if (!category && (monthPeriod.months || explicitDue.dateStr || genericCommunicationSignal) && communicationDateStr) {
      category = 'Communication response period';
      diagnostics.category = category;
      diagnostics.categoryEvidence = monthPeriod.months || explicitDue.dateStr
        ? 'Inferred from communication-period evidence in document text'
        : 'Inferred from generic communication text signal';
    }

    if (!category) {
      return { hints: [], diagnostics };
    }

    let explicitAdded = false;
    if (explicitDue.dateStr) {
      pushHint({
        label: category,
        dateStr: explicitDue.dateStr,
        sourceDate: communicationDateStr || docDateStr,
        confidence: 'high',
        level: /rule\s*116/i.test(category) ? 'warn' : 'bad',
        evidence: explicitDue.evidence,
      });
      explicitAdded = true;
    }

    if (!explicitAdded && responseMonths && communicationDate) {
      const calc = addCalendarMonthsDetailed(communicationDate, responseMonths);
      const communicationFromDocFallback = /doclist date fallback/i.test(String(diagnostics.communicationEvidence || ''));
      const confidence = monthPeriod.months
        ? (communicationFromDocFallback ? 'medium' : 'high')
        : 'low';

      pushHint({
        label: category,
        dateStr: formatDate(calc.date),
        sourceDate: communicationDateStr,
        confidence,
        level: /rule\s*116/i.test(category) ? 'warn' : 'bad',
        evidence: `${responseEvidence || `Derived from ${responseMonths} month response period`} from communication date ${communicationDateStr}${calc.rolledOver ? ` (rollover ${calc.fromDay}→${calc.toDay})` : ''}`,
      });
    }

    return {
      hints: dedupe(hints, (h) => `${h.label}|${h.dateStr}`),
      diagnostics,
    };
  }

  function normalizePdfDocumentUrl(rawUrl) {
    const absolutize = (candidate) => {
      const value = String(candidate || '').trim();
      if (!value) return '';
      try {
        return new URL(value.replace(/&amp;/gi, '&'), location.origin).toString();
      } catch {
        return '';
      }
    };

    let raw = String(rawUrl || '').trim();
    if (!raw) return '';

    if (/^javascript:/i.test(raw)) {
      const js = raw
        .replace(/^javascript:\s*/i, '')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"');

      let decodedJs = js;
      try {
        decodedJs = decodeURIComponent(js);
      } catch {
        // keep raw form
      }

      const source = `${js}\n${decodedJs}`;

      const absMatch = source.match(/https?:\/\/[^'"\s)]+/i)?.[0] || '';
      if (absMatch) {
        const cleanedAbs = absMatch
          .replace(/%27.*$/i, '')
          .replace(/&#39;.*$/i, '')
          .split("'")[0]
          .split('"')[0]
          .split(')')[0]
          .split(',')[0];
        const absUrl = absolutize(cleanedAbs);
        if (absUrl) return absUrl;
      }

      const relMatch = source.match(/\/?application\?documentId=[^'"\s)]+/i)?.[0] || '';
      if (relMatch) {
        let cleanedRel = relMatch
          .replace(/%27.*$/i, '')
          .replace(/&#39;.*$/i, '')
          .split("'")[0]
          .split('"')[0]
          .split(')')[0]
          .split(',')[0];
        if (!cleanedRel.startsWith('/')) cleanedRel = `/${cleanedRel}`;
        return absolutize(cleanedRel);
      }

      return '';
    }

    raw = raw.replace(/%27.*$/i, '');
    return absolutize(raw);
  }

  async function resolvePdfUrl(url, signal) {
    const normalized = normalizePdfDocumentUrl(url);
    if (!normalized) return '';
    if (/\.pdf(?:\?|$)/i.test(normalized)) return normalized;

    try {
      if (/[?&]documentId=/i.test(normalized) && /\/application\b/i.test(new URL(normalized).pathname)) {
        return normalized;
      }
    } catch {
      // continue to HTML fallback
    }

    try {
      const html = await fetchWithRetry(normalized, signal);
      const doc = parseHtml(html);

      const links = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
      const pdfHref = links.find((href) => /\.pdf(?:\?|$)/i.test(href));
      if (pdfHref) return new URL(pdfHref, normalized).toString();

      const embeds = [
        ...[...doc.querySelectorAll('iframe[src], embed[src]')].map((el) => el.getAttribute('src') || ''),
        ...[...doc.querySelectorAll('object[data]')].map((el) => el.getAttribute('data') || ''),
      ].filter(Boolean);

      const embedHref = embeds.find((href) => /\.pdf(?:\?|$)/i.test(href) || /[?&]documentId=/i.test(href));
      if (embedHref) return new URL(embedHref, normalized).toString();

      return '';
    } catch {
      return '';
    }
  }

  function pdfContentToStructuredText(content) {
    const rawItems = Array.isArray(content?.items) ? content.items : [];
    const items = rawItems
      .map((it, idx) => ({
        str: String(it?.str || '').trim(),
        x: Number(it?.transform?.[4] || 0),
        y: Number(it?.transform?.[5] || 0),
        idx,
      }))
      .filter((it) => !!it.str);

    if (!items.length) return '';

    const hasCoords = items.some((it) => Number.isFinite(it.x) && Number.isFinite(it.y) && (it.x !== 0 || it.y !== 0));
    if (!hasCoords) return items.map((it) => it.str).join(' ');

    items.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 2.5) return dy;
      const dx = a.x - b.x;
      if (Math.abs(dx) > 0.5) return dx;
      return a.idx - b.idx;
    });

    const lines = [];
    let current = [];
    let lineY = null;

    const flush = () => {
      if (!current.length) return;
      current.sort((a, b) => (a.x - b.x) || (a.idx - b.idx));
      lines.push(current.map((it) => it.str).join(' '));
      current = [];
      lineY = null;
    };

    for (const item of items) {
      if (lineY == null) {
        current.push(item);
        lineY = item.y;
        continue;
      }
      if (Math.abs(item.y - lineY) <= 2.5) {
        current.push(item);
        lineY = (lineY + item.y) / 2;
        continue;
      }
      flush();
      current.push(item);
      lineY = item.y;
    }
    flush();

    return lines.join('\n');
  }

  function isPdfBinaryData(binary) {
    if (!binary) return false;
    const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
    if (bytes.length < 5) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
  }

  function binaryToUtf8(binary, maxBytes = 300000) {
    if (!binary) return '';
    const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
    const slice = bytes.slice(0, Math.max(0, maxBytes));
    try {
      if (typeof TextDecoder === 'function') return new TextDecoder('utf-8', { fatal: false }).decode(slice);
    } catch {
      // fallback below
    }
    return Array.from(slice).map((b) => String.fromCharCode(b)).join('');
  }

  function hasMeaningfulCommunicationText(raw) {
    const txt = normalize(String(raw || ''));
    if (!txt) return false;
    const alphaCount = (txt.match(/[A-Za-z]/g) || []).length;
    return txt.length >= 120 && alphaCount >= 40;
  }

  function focusCommunicationContextText(raw) {
    const txt = normalize(String(raw || ''));
    if (!txt) return '';

    const low = txt.toLowerCase();
    const anchors = [
      'registered letter',
      'date of communication',
      'date of this communication',
      'time limit',
      'within',
      'article 94(3)',
      'art. 94(3)',
      'rule 71(3)',
      'rule 116',
      'rule 161',
      'rule 162',
    ];

    let idx = -1;
    for (const anchor of anchors) {
      const pos = low.indexOf(anchor);
      if (pos >= 0 && (idx < 0 || pos < idx)) idx = pos;
    }

    if (idx < 0) return txt;
    const start = Math.max(0, idx - 1200);
    const end = Math.min(txt.length, idx + 3200);
    let focused = txt.slice(start, end);

    const regIdx = low.lastIndexOf('registered letter');
    if (regIdx >= 0 && (regIdx < start || regIdx > end)) {
      const regStart = Math.max(0, regIdx - 220);
      const regEnd = Math.min(txt.length, regIdx + 380);
      focused = `${focused}\n${txt.slice(regStart, regEnd)}`;
    }

    return dedupeMultiline(focused);
  }

  function deriveDocumentPageUrlFromPdfUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || ''), location.origin);
      const docId = normalize(u.searchParams.get('documentId') || '');
      if (!docId) return '';

      const number = normalize(u.searchParams.get('number') || u.searchParams.get('appnumber') || '').toUpperCase();
      const lng = normalize(u.searchParams.get('lng') || currentLang() || 'en');

      const out = new URL(`${location.origin}/application`);
      out.searchParams.set('documentId', docId);
      if (number) out.searchParams.set('number', number);
      if (lng) out.searchParams.set('lng', lng);
      out.searchParams.set('npl', 'false');
      return out.toString();
    } catch {
      return '';
    }
  }

  function extractPdfLikeUrlFromHtml(html, baseUrl) {
    const doc = parseHtml(String(html || ''));
    const attrCandidates = [
      ...[...doc.querySelectorAll('a[href]')].map((el) => el.getAttribute('href') || ''),
      ...[...doc.querySelectorAll('iframe[src], embed[src]')].map((el) => el.getAttribute('src') || ''),
      ...[...doc.querySelectorAll('object[data]')].map((el) => el.getAttribute('data') || ''),
    ];

    const scriptText = [...doc.querySelectorAll('script')].map((s) => text(s)).join('\n');
    const regexCandidates = [
      ...(scriptText.match(/https?:\/\/[^\s"')>]+\.pdf(?:\?[^\s"')>]*)?/gi) || []),
      ...(scriptText.match(/\/?application\?documentId=[^\s"')>]+/gi) || []),
    ];

    const all = [...attrCandidates, ...regexCandidates].map((v) => normalize(String(v || ''))).filter(Boolean);
    for (const raw of all) {
      const normalized = normalizePdfDocumentUrl(raw) || (() => {
        try { return new URL(raw, baseUrl).toString(); } catch { return ''; }
      })();
      if (!normalized) continue;
      if (/\.pdf(?:\?|$)/i.test(normalized) || /[?&]documentId=/i.test(normalized)) return normalized;
    }
    return '';
  }

  async function extractTextFromPdfViaOcr(binary, pdfjs, signal) {
    const tesseract = await ensureTesseract(signal);
    const data = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
    const loadingTask = pdfjs.getDocument({ data, disableWorker: true, useWorkerFetch: false, isEvalSupported: false });
    const pdf = await loadingTask.promise;

    try {
      const maxPages = Math.min(pdf.numPages || 0, OCR_MAX_PAGES);
      const chunks = [];
      let pagesUsed = 0;

      for (let i = 1; i <= maxPages; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!ctx) continue;

        await page.render({ canvasContext: ctx, viewport }).promise;

        const result = await tesseract.recognize(canvas, 'eng', OCR_RECOGNIZE_OPTIONS);
        const pageText = normalize(String(result?.data?.text || ''));
        if (pageText) chunks.push(pageText);
        pagesUsed += 1;

        canvas.width = 1;
        canvas.height = 1;

        const joined = normalize(chunks.join('\n'));
        if (/\bregistered\s+letter\b|\btime\s+limit\b|\bwithin\b|\barticle\s*94\s*\(\s*3\s*\)\b|\bart\.?\s*94\s*\(\s*3\s*\)\b/i.test(joined) && joined.length > 120) {
          break;
        }
      }

      return { text: normalize(chunks.join('\n')), pagesUsed };
    } finally {
      try { await pdf.destroy(); } catch {}
    }
  }

  async function extractPdfText(url, signal, pdfjsInstance = null) {
    const pdfjs = pdfjsInstance || await ensurePdfJs(signal);

    const parsePdfBinaryToText = async (binary) => {
      const data = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
      const loadingTask = pdfjs.getDocument({ data, disableWorker: true, useWorkerFetch: false, isEvalSupported: false });
      const pdf = await loadingTask.promise;
      try {
        const maxPages = Math.min(pdf.numPages || 0, 8);
        const chunks = [];
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const txt = pdfContentToStructuredText(content);
          if (txt) chunks.push(txt);
        }
        return chunks.join('\n');
      } finally {
        try { await pdf.destroy(); } catch {}
      }
    };

    const htmlFallbackFromPayload = (html, transport, resolvedUrl) => {
      const raw = bodyText(parseHtml(String(html || '')));
      const focused = focusCommunicationContextText(raw);
      if (!hasMeaningfulCommunicationText(focused)) return null;
      return { text: focused, transport, resolvedUrl, isPdf: false, usedOcr: false, ocrPages: 0 };
    };

    const tryDocumentPageFallback = async (seedUrl, transport) => {
      const docPageUrl = deriveDocumentPageUrlFromPdfUrl(seedUrl);
      if (!docPageUrl) return null;
      try {
        const html = await fetchWithRetry(docPageUrl, signal);
        return htmlFallbackFromPayload(html, transport, docPageUrl);
      } catch {
        return null;
      }
    };

    const binary = await fetchWithRetry(url, signal, 'arrayBuffer');
    if (isPdfBinaryData(binary)) {
      const text = normalize(await parsePdfBinaryToText(binary));
      if (text) {
        return { text, transport: 'pdfjs', resolvedUrl: url, isPdf: true, usedOcr: false, ocrPages: 0 };
      }

      try {
        const ocr = await extractTextFromPdfViaOcr(binary, pdfjs, signal);
        const ocrText = focusCommunicationContextText(ocr?.text || '');
        if (hasMeaningfulCommunicationText(ocrText)) {
          return {
            text: ocrText,
            transport: 'pdfjs-ocr',
            resolvedUrl: url,
            isPdf: true,
            usedOcr: true,
            ocrPages: Number(ocr?.pagesUsed || 0),
          };
        }
      } catch {
        // continue with HTML fallbacks
      }

      const docPageFallback = await tryDocumentPageFallback(url, 'html-fallback-from-document-page-after-empty-pdf-text');
      if (docPageFallback) return docPageFallback;

      return { text: '', transport: 'pdfjs-empty-text', resolvedUrl: url, isPdf: true, usedOcr: false, ocrPages: 0 };
    }

    const htmlPayload = binaryToUtf8(binary);
    const looksHtml = /<\s*html\b|<!doctype\s+html|<\s*body\b|<\s*title\b/i.test(String(htmlPayload || '').slice(0, 2000));
    if (!looksHtml) {
      throw new Error('Invalid PDF structure (non-PDF payload)');
    }

    const directHtmlFallback = htmlFallbackFromPayload(htmlPayload, 'html-fallback', url);

    const linkedUrl = extractPdfLikeUrlFromHtml(htmlPayload, url);
    if (linkedUrl && linkedUrl !== url) {
      const linkedBinary = await fetchWithRetry(linkedUrl, signal, 'arrayBuffer');
      if (isPdfBinaryData(linkedBinary)) {
        const linkedText = normalize(await parsePdfBinaryToText(linkedBinary));
        if (linkedText) {
          return { text: linkedText, transport: 'pdfjs-via-linked-url', resolvedUrl: linkedUrl, isPdf: true, usedOcr: false, ocrPages: 0 };
        }

        try {
          const linkedOcr = await extractTextFromPdfViaOcr(linkedBinary, pdfjs, signal);
          const linkedOcrText = focusCommunicationContextText(linkedOcr?.text || '');
          if (hasMeaningfulCommunicationText(linkedOcrText)) {
            return {
              text: linkedOcrText,
              transport: 'pdfjs-via-linked-url-ocr',
              resolvedUrl: linkedUrl,
              isPdf: true,
              usedOcr: true,
              ocrPages: Number(linkedOcr?.pagesUsed || 0),
            };
          }
        } catch {
          // continue with HTML fallbacks
        }

        const parentHtmlFallback = htmlFallbackFromPayload(htmlPayload, 'html-fallback-from-document-page-after-empty-linked-pdf-text', url);
        if (parentHtmlFallback) return parentHtmlFallback;

        const linkedDocPageFallback = await tryDocumentPageFallback(linkedUrl, 'html-fallback-from-linked-document-page-after-empty-pdf-text');
        if (linkedDocPageFallback) return linkedDocPageFallback;

        return { text: '', transport: 'pdfjs-via-linked-url-empty-text', resolvedUrl: linkedUrl, isPdf: true, usedOcr: false, ocrPages: 0 };
      }

      const linkedHtml = binaryToUtf8(linkedBinary);
      const linkedHtmlFallback = htmlFallbackFromPayload(linkedHtml, 'html-fallback-via-linked-url', linkedUrl);
      if (linkedHtmlFallback) return linkedHtmlFallback;
    }

    if (directHtmlFallback) return directHtmlFallback;

    throw new Error('Invalid PDF structure (HTML payload without readable text)');
  }

  function pdfDeadlineCandidates(docs = []) {
    return docs.filter((d) => {
      const actor = String(d.actor || '').toLowerCase();
      const text = normalize(`${d.title || ''} ${d.procedure || ''}`).toLowerCase();
      if (!text) return false;

      const ruleSignal = /rule\s*71\s*\(\s*3\s*\)|\brule\s*116\b|\brule\s*161\b|\brule\s*162\b|\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)/.test(text);
      const communicationSignal = /\bcommunication\b|\bnotification\b|\bsummons\b|\binvitation\b|\bintention to grant\b|\bexamining division\b|\bopposition division\b/.test(text);

      if (ruleSignal) return true;
      if (communicationSignal && actor !== 'applicant') return true;
      return false;
    }).slice(0, 8);
  }

  function storePdfDeadlineSource(caseNo, dependencyStamp, status, data = { hints: [], scanned: [] }, error = '') {
    storeCaseSource(caseNo, 'pdfDeadlines', {
      title: 'PDF-derived deadlines',
      status,
      transport: 'fetch+pdfjs',
      dependencyStamp,
      error,
      data,
    });
  }

  function derivePdfDeadlineStatus(hints, scanned, successfulCandidates) {
    if ((hints || []).length) return 'ok';
    if ((successfulCandidates || 0) > 0 || (scanned || []).length > 0) return 'empty';
    return 'error';
  }

  function buildPdfDeadlineSummary(scanned, successfulCandidates, failedCandidates) {
    return {
      scannedDocs: scanned.length,
      successfulCandidates,
      failedCandidates,
      withHints: scanned.filter((x) => (x.hintCount || 0) > 0).length,
      withCommunicationDate: scanned.filter((x) => !!x.communicationDate).length,
      withResponsePeriod: scanned.filter((x) => Number(x.responseMonths || 0) > 0).length,
      withProofLine: scanned.filter((x) => !!x.registeredLetterProofLine).length,
      withOcr: scanned.filter((x) => !!x.usedOcr).length,
    };
  }

  async function scanPdfDeadlineCandidate(caseNo, doc, signal, pdfjs) {
    addLog(caseNo, 'info', 'PDF candidate scan start', { source: 'pdfDeadlines', doc: doc.title || '', docDate: doc.dateStr || '' });

    const resolvedUrl = await resolvePdfUrl(doc.url, signal);
    if (!resolvedUrl) {
      addLog(caseNo, 'warn', 'PDF URL could not be resolved from document page', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        docUrl: doc.url || '',
        normalizedDocUrl: normalizePdfDocumentUrl(doc.url || ''),
      });
      return { scanSucceeded: false, parsedHints: [], scannedEntry: null };
    }

    const extracted = await extractPdfText(resolvedUrl, signal, pdfjs);
    const text = normalize(String(extracted?.text || ''));
    const parseTransport = String(extracted?.transport || 'unknown');
    const parseUrl = String(extracted?.resolvedUrl || resolvedUrl);

    if (extracted?.usedOcr) {
      addLog(caseNo, 'ok', 'PDF OCR fallback used', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        url: parseUrl,
        transport: parseTransport,
        ocrPages: Number(extracted?.ocrPages || 0),
      });
    }

    if (!text) {
      addLog(caseNo, 'warn', 'PDF opened but extracted text was empty', { source: 'pdfDeadlines', doc: doc.title || '', url: parseUrl, transport: parseTransport });
      return { scanSucceeded: true, parsedHints: [], scannedEntry: null };
    }

    if (!extracted?.isPdf) {
      addLog(caseNo, 'warn', 'PDF binary unavailable; using HTML fallback text extraction', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        url: parseUrl,
        transport: parseTransport,
      });
    }

    const parsed = parsePdfDeadlineHints(text, {
      docDateStr: doc.dateStr,
      docTitle: doc.title,
      docProcedure: doc.procedure,
    });
    const parsedHints = Array.isArray(parsed?.hints) ? parsed.hints : [];
    const diagnostics = parsed?.diagnostics || {};

    const proofLine = normalize(diagnostics.registeredLetterProofLine || '');
    addLog(caseNo, proofLine ? 'ok' : 'warn', `PDF proof line (below "Registered Letter"): ${proofLine || 'not found'}`, {
      source: 'pdfDeadlines',
      doc: doc.title || '',
      docDate: doc.dateStr || '',
      transport: parseTransport,
      url: parseUrl,
    });

    addLog(caseNo, 'info', 'PDF parse diagnostics', {
      source: 'pdfDeadlines',
      doc: doc.title || '',
      transport: parseTransport,
      url: parseUrl,
      usedOcr: !!extracted?.usedOcr,
      ocrPages: Number(extracted?.ocrPages || 0),
      category: diagnostics.category || '',
      categoryEvidence: diagnostics.categoryEvidence || '',
      communicationDate: diagnostics.communicationDate || '',
      communicationEvidence: diagnostics.communicationEvidence || '',
      responseMonths: Number(diagnostics.responseMonths || 0),
      responseEvidence: diagnostics.responseEvidence || '',
      explicitDeadlineDate: diagnostics.explicitDeadlineDate || '',
      explicitDeadlineEvidence: diagnostics.explicitDeadlineEvidence || '',
      registeredLetterLine: String(diagnostics.registeredLetterLine || '').slice(0, 180),
      registeredLetterProofLine: String(diagnostics.registeredLetterProofLine || '').slice(0, 180),
      textChars: text.length,
    });

    const doclistDate = normalizeDateString(doc.dateStr || '');
    const commDate = normalizeDateString(diagnostics.communicationDate || '');
    if (doclistDate && commDate && doclistDate !== commDate) {
      addLog(caseNo, 'warn', 'PDF communication date differs from doclist date (using PDF date for deadline derivation)', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        doclistDate,
        pdfCommunicationDate: commDate,
      });
    }

    if (parsedHints.length) {
      addLog(caseNo, 'ok', `PDF deadline hints parsed: ${parsedHints.length}`, {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        transport: parseTransport,
        url: parseUrl,
        hints: parsedHints.map((h) => `${h.label}=${h.dateStr}`),
      });
    } else {
      addLog(caseNo, 'info', 'PDF opened but no deadline hint produced for this document', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        transport: parseTransport,
        url: parseUrl,
        category: diagnostics.category || '',
      });
    }

    return {
      scanSucceeded: true,
      parsedHints,
      scannedEntry: {
        title: doc.title,
        dateStr: doc.dateStr,
        url: parseUrl,
        transport: parseTransport,
        usedOcr: !!extracted?.usedOcr,
        ocrPages: Number(extracted?.ocrPages || 0),
        hintCount: parsedHints.length,
        category: String(diagnostics.category || ''),
        communicationDate: String(diagnostics.communicationDate || ''),
        responseMonths: Number(diagnostics.responseMonths || 0),
        explicitDeadlineDate: String(diagnostics.explicitDeadlineDate || ''),
        registeredLetterProofLine: proofLine,
      },
    };
  }

  async function refreshPdfDeadlines(caseNo, signal, force = false) {
    if (!caseNo) return;
    const c = getCase(caseNo);
    const dependencyStamp = derivedDependencyStamp(caseNo, 'pdfDeadlines');
    const cached = c.sources.pdfDeadlines;
    if (!force && isFresh(cached, options().refreshHours, { allowEmpty: true, dependencyStamp })) return;

    const docs = caseDocs(c);
    if (!docs.length) {
      storePdfDeadlineSource(caseNo, dependencyStamp, 'empty');
      addLog(caseNo, 'info', 'PDF deadline scan skipped: doclist cache is empty', { source: 'pdfDeadlines' });
      return;
    }

    const candidates = pdfDeadlineCandidates(docs);
    if (!candidates.length) {
      storePdfDeadlineSource(caseNo, dependencyStamp, 'empty');
      addLog(caseNo, 'info', 'PDF deadline scan skipped: no communication-type documents found', { source: 'pdfDeadlines' });
      return;
    }

    let pdfjs = null;
    try {
      pdfjs = await ensurePdfJs(signal);
      addLog(caseNo, 'ok', 'PDF parser engine ready', { source: 'pdfDeadlines' });
    } catch (error) {
      const errText = String(error?.message || error || 'unknown error');
      addLog(caseNo, 'error', `PDF parser unavailable: ${errText}`, { source: 'pdfDeadlines' });
      storePdfDeadlineSource(caseNo, dependencyStamp, 'error', { hints: [], scanned: [] }, errText);
      addLog(caseNo, 'warn', 'PDF deadline parse aborted (parser engine unavailable)', { source: 'pdfDeadlines' });
      return;
    }

    const hints = [];
    const scanned = [];
    let failedCandidates = 0;
    let successfulCandidates = 0;
    let lastCandidateError = null;

    for (const doc of candidates) {
      if (signal?.aborted) return;
      try {
        const result = await scanPdfDeadlineCandidate(caseNo, doc, signal, pdfjs);
        if (result.scanSucceeded) successfulCandidates += 1;
        if (Array.isArray(result.parsedHints) && result.parsedHints.length) hints.push(...result.parsedHints);
        if (result.scannedEntry) scanned.push(result.scannedEntry);
      } catch (error) {
        failedCandidates += 1;
        lastCandidateError = error;
        addLog(caseNo, 'warn', `PDF deadline parse skipped: ${error?.message || error}`, { source: 'pdfDeadlines', doc: doc.title || '' });
      }
    }

    const dedupedHints = dedupe(hints, (h) => `${h.label}|${h.dateStr}`);
    const pdfStatus = derivePdfDeadlineStatus(dedupedHints, scanned, successfulCandidates);
    storePdfDeadlineSource(
      caseNo,
      dependencyStamp,
      pdfStatus,
      { hints: dedupedHints, scanned },
      pdfStatus === 'error' ? String(lastCandidateError?.message || lastCandidateError || 'PDF deadline scan failed') : '',
    );

    const summary = buildPdfDeadlineSummary(scanned, successfulCandidates, failedCandidates);
    const summaryLevel = pdfStatus === 'error' ? 'error' : (dedupedHints.length ? 'ok' : 'info');
    const summaryMessage = pdfStatus === 'error'
      ? 'PDF deadline parse failed for all candidate documents'
      : `PDF deadline parse ${dedupedHints.length ? `found ${dedupedHints.length} hint(s)` : 'found no explicit hints'}`;
    addLog(caseNo, summaryLevel, summaryMessage, { source: 'pdfDeadlines', ...summary });

    if (!signal?.aborted && tabSlug() === 'doclist' && (detectAppNo() || runtime.appNo || '') === caseNo) {
      enhanceDoclistGrouping();
      renderPanel();
    }
  }


  async function fetchWithRetry(url, signal, responseType = 'text') {
    let lastError;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        return await fetchWithTimeout(url, signal, responseType);
      } catch (error) {
        lastError = error;
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        if (attempt >= FETCH_RETRIES) throw error;
      }
    }
    throw lastError;
  }

  async function runPool(tasks, concurrency) {
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const i = idx++;
        await tasks[i]();
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  }

  function cancelPrefetch() {
    if (runtime.abortController) {
      runtime.abortController.abort();
      runtime.abortController = null;
    }
    runtime.fetching = false;
    runtime.fetchLabel = 'Idle';
    runtime.fetchCaseNo = null;
  }

  function beginPrefetch(caseNo) {
    cancelPrefetch();
    const controller = new AbortController();
    runtime.abortController = controller;
    runtime.fetching = true;
    runtime.fetchCaseNo = caseNo;
    runtime.fetchLabel = 'Starting';
    return controller;
  }

  function prefetchPlan(caseNo, force = false, refreshHours = options().refreshHours) {
    const needed = [];
    const freshKeys = [];

    for (const src of SOURCES) {
      if (force) {
        needed.push(src);
        continue;
      }

      const cached = getCase(caseNo).sources[src.key];
      const fresh = isFresh(cached, refreshHours, { allowEmpty: true, allowNotFound: true });
      if (fresh) {
        freshKeys.push(src.key);
        addLog(caseNo, 'info', `Skip fresh source ${src.key}`);
      } else {
        needed.push(src);
      }
    }

    return {
      needed,
      neededKeys: needed.map((src) => src.key),
      freshKeys,
    };
  }

  async function prefetchSource(caseNo, src, controller, progress) {
    if (controller.signal.aborted) return;

    const url = sourceUrl(caseNo, src.slug);
    runtime.fetchLabel = `${progress.completed + 1}/${progress.total}`;
    addLog(caseNo, 'info', `Request source ${src.key}`, { source: src.key, transport: 'fetch', url });
    scheduleRender();

    try {
      const html = await fetchWithRetry(url, controller.signal);
      if (controller.signal.aborted) return;

      addLog(caseNo, 'ok', `Fetch success ${src.key}`, { source: src.key, sizeKb: +(html.length / 1024).toFixed(2), transport: 'fetch' });
      const parsedDoc = parseHtml(html);
      const parsed = parseSource(src.key, parsedDoc, caseNo);
      const classified = classifyParsedSourceState(src.key, parsedDoc, parsed);
      const parseMessage = classified.status === 'ok'
        ? `Parse success ${src.key}`
        : classified.status === 'notFound'
          ? `Parse result not found ${src.key}`
          : `Parse result empty ${src.key}`;
      const parseLevel = classified.status === 'ok' ? 'ok' : classified.status === 'notFound' ? 'warn' : 'info';
      addLog(caseNo, parseLevel, parseMessage, { transport: 'fetch', status: classified.status, reason: classified.reason, ...sourceDiagnostics(src.key, parsed) });

      storeCaseSource(caseNo, src.key, {
        title: src.title,
        status: classified.status,
        url,
        transport: 'fetch',
        data: parsed,
      });
      addLog(caseNo, 'info', `Cache write ${src.key}`, { source: src.key });
    } catch (error) {
      if (controller.signal.aborted) return;
      addLog(caseNo, 'error', `Fetch/parse failure ${src.key}: ${error?.message || error}`, { source: src.key, transport: 'fetch' });
      storeCaseSource(caseNo, src.key, {
        title: src.title,
        status: 'error',
        url,
        transport: 'fetch',
        error: String(error?.message || error),
      });
    }

    progress.completed += 1;
    if (runtime.appNo === caseNo) scheduleRender();
  }

  async function refreshDerivedPrefetchSources(caseNo, signal, force) {
    try {
      await refreshUpcRegistry(caseNo, signal, force);
    } catch {
      // non-blocking
    }

    try {
      await refreshPdfDeadlines(caseNo, signal, force);
    } catch {
      // non-blocking
    }
  }

  function completePrefetch(caseNo, controller) {
    if (runtime.abortController !== controller) return;

    const c = getCase(caseNo);
    const counts = sourceStatusCounts(c);
    const statusBySource = Object.fromEntries(SOURCES.map((s) => [s.key, c.sources[s.key]?.status || 'missing']));
    addLog(caseNo, counts.error ? 'warn' : 'ok', `Background prefetch finish (${sourceStatusSummaryText(counts)})`, {
      source: 'prefetch',
      counts,
      statusBySource,
    });
    runtime.fetching = false;
    runtime.fetchLabel = 'Idle';
    runtime.abortController = null;
    runtime.fetchCaseNo = null;
    flushNow();
    scheduleRender();
  }

  async function prefetchCase(caseNo, force = false) {
    const opts = options();
    if (!caseNo) return;
    if (!opts.preloadAllTabs && !force) {
      addLog(caseNo, 'info', 'Auto prefetch skipped (preloadAllTabs disabled)', { source: 'prefetch' });
      return;
    }

    if (runtime.fetchCaseNo === caseNo && runtime.fetching && !force) {
      addLog(caseNo, 'info', 'Prefetch request ignored (already running for this case)', { source: 'prefetch' });
      return;
    }

    const controller = beginPrefetch(caseNo);
    addLog(caseNo, 'info', `Background prefetch start${force ? ' (forced)' : ''}`);
    scheduleRender();

    try {
      const plan = prefetchPlan(caseNo, force, opts.refreshHours);
      addLog(caseNo, 'info', 'Prefetch plan ready', {
        source: 'prefetch',
        force: !!force,
        needed: plan.neededKeys,
        fresh: plan.freshKeys,
      });

      if (!plan.needed.length) {
        addLog(caseNo, 'ok', 'Background prefetch complete (all fresh)');
        runtime.fetching = false;
        runtime.fetchLabel = 'Idle';
        scheduleRender();
        return;
      }

      const progress = { completed: 0, total: plan.needed.length };
      await runPool(plan.needed.map((src) => async () => {
        await prefetchSource(caseNo, src, controller, progress);
      }), FETCH_CONCURRENCY);
    } finally {
      if (runtime.abortController === controller) {
        await refreshDerivedPrefetchSources(caseNo, controller.signal, force);
        completePrefetch(caseNo, controller);
      }
    }
  }

  function addCalendarMonthsDetailed(date, months) {
    const src = new Date(date);
    if (Number.isNaN(src.getTime())) return { date: new Date(NaN), rolledOver: false, fromDay: 0, toDay: 0 };

    const srcDay = src.getDate();
    const srcMonth = src.getMonth();
    const srcYear = src.getFullYear();
    const rawMonth = srcMonth + Number(months || 0);

    const targetYear = srcYear + Math.floor(rawMonth / 12);
    const targetMonth = ((rawMonth % 12) + 12) % 12;
    const lastDay = endOfMonth(targetYear, targetMonth).getDate();
    const targetDay = Math.min(srcDay, lastDay);

    return {
      date: new Date(targetYear, targetMonth, targetDay),
      rolledOver: srcDay !== targetDay,
      fromDay: srcDay,
      toDay: targetDay,
    };
  }

  function addMonths(date, months) {
    return addCalendarMonthsDetailed(date, months).date;
  }

  function endOfMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0);
  }

  function epRenewalDueDate(filingDate, patentYear) {
    if (!(filingDate instanceof Date) || Number.isNaN(filingDate.getTime())) return null;
    if (!Number.isFinite(patentYear) || patentYear < 3) return null;
    const anniversaryYear = filingDate.getFullYear() + patentYear - 1;
    return endOfMonth(anniversaryYear, filingDate.getMonth());
  }

  function buildDeadlineRecords(docs, eventHistory = {}, legal = {}) {
    const sortedDocs = [...(docs || [])].sort(compareDateDesc);
    const sortedEvents = dedupe([...(eventHistory.events || []), ...(legal.events || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}`).sort(compareDateDesc);
    const sortedCodedEvents = dedupe([...(legal.codedEvents || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}|${e.originalCode}|${e.codexKey}`).sort(compareDateDesc);
    return dedupe([
      ...sortedDocs.map((d) => ({
        dateStr: d.dateStr,
        title: d.title || '',
        detail: d.procedure || d.detail || '',
        actor: d.actor || 'Other',
        source: 'Documents',
      })),
      ...sortedEvents.map((e) => ({
        dateStr: e.dateStr,
        title: e.title || '',
        detail: e.detail || '',
        actor: /applicant|filed by applicant|by applicant/i.test(`${e.title || ''} ${e.detail || ''}`) ? 'Applicant' : 'EPO',
        source: 'Event',
        codexKey: e.codexKey || '',
        codexPhase: e.codexPhase || '',
        codexClass: e.codexClass || '',
      })),
      ...sortedCodedEvents.map((e) => ({
        dateStr: e.dateStr,
        title: e.title || '',
        detail: e.detail || '',
        actor: /applicant|filed by applicant|by applicant/i.test(`${e.title || ''} ${e.detail || ''}`) ? 'Applicant' : 'EPO',
        source: 'Coded legal event',
        codexKey: e.codexKey || '',
        codexPhase: e.codexPhase || '',
        codexClass: e.codexClass || '',
      })),
    ], (r) => `${r.dateStr}|${r.title}|${r.detail}|${r.source}|${r.codexKey || ''}`).sort(compareDateDesc);
  }

  function postureRecord(records = [], regex) {
    return (records || []).find((record) => regex.test(`${record.title || ''} ${record.detail || ''}`.toLowerCase())) || null;
  }

  function postureRecordByCodex(records = [], internalKeys = []) {
    const keys = new Set((internalKeys || []).filter(Boolean));
    return (records || []).find((record) => record.codexKey && keys.has(record.codexKey)) || null;
  }

  function postureRecordDate(record) {
    return parseDateString(record?.dateStr || '');
  }

  function postureLossLabel(record) {
    const text = `${record?.title || ''} ${record?.detail || ''}`.toLowerCase();
    if (/non-entry into european phase/.test(text)) return 'non-entry into European phase';
    if (/translations of claims\/payment missing/.test(text)) return 'grant-formalities failure';
    if (/non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(text)) return 'fees / written-opinion failure';
    if (/non-reply to written opinion/.test(text)) return 'no reply to the written opinion';
    if (/loss of rights|rule\s*112\(1\)/.test(text)) return 'loss-of-rights communication';
    if (/withdrawn/.test(text)) return 'withdrawn posture';
    return 'adverse procedural posture';
  }

  function postureRecoveryLabel(record) {
    const text = `${record?.title || ''} ${record?.detail || ''}`.toLowerCase();
    if (/further processing/.test(text)) return 'further processing';
    if (/re-establishment|rights re-established/.test(text)) return 're-establishment';
    return 'recovery procedure';
  }

  function proceduralPostureModel(main, docs, eventHistory = {}, legal = {}) {
    const statusRaw = dedupeMultiline(main?.statusRaw || '');
    const statusSummary = summarizeStatus(statusRaw);
    const statusLow = statusRaw.toLowerCase();
    const records = buildDeadlineRecords(docs, eventHistory, legal);
    const latestLoss = postureRecordByCodex(records, ['LOSS_OF_RIGHTS_EVENT', 'APPLICATION_DEEMED_WITHDRAWN'])
      || postureRecord(records, /application deemed to be withdrawn|deemed to be withdrawn|loss of rights|rule\s*112\(1\)|application refused|application rejected|revoked|withdrawn by applicant|application withdrawn/);
    const detailedLoss = postureRecord(records, /non-entry into european phase|translations of claims\/payment missing|non-payment of examination fee\/designation fee\/non-reply to written opinion|non-reply to written opinion/);
    const effectiveLoss = detailedLoss || latestLoss;
    const latestRecovery = postureRecordByCodex(records, ['FURTHER_PROCESSING_DECISION', 'FURTHER_PROCESSING_REQUEST'])
      || postureRecord(records, /decision to allow further processing|further processing|request for further processing|re-establishment|rights re-established/);
    const latestGrantDecision = postureRecordByCodex(records, ['EXPECTED_GRANT'])
      || postureRecord(records, /decision to grant a european patent|mention of grant|patent granted|the patent has been granted/);
    const latestNoOpposition = postureRecordByCodex(records, ['NO_OPPOSITION_FILED'])
      || postureRecord(records, /no opposition filed within time limit/);
    const latestR71 = postureRecordByCodex(records, ['GRANT_R71_3_EVENT'])
      || postureRecord(records, /grant of patent is intended|intention to grant|rule\s*71\(3\)|text intended for grant/);
    const latestSearchPublication = postureRecordByCodex(records, ['SEARCH_REPORT_PUBLICATION']);

    const latestLossDate = postureRecordDate(latestLoss);
    const latestRecoveryDate = postureRecordDate(latestRecovery);
    const latestGrantDecisionDate = postureRecordDate(latestGrantDecision);
    const recovered = !!(latestLossDate && latestRecoveryDate && latestRecoveryDate >= latestLossDate);
    const recoveredBeforeGrant = !!(recovered && latestGrantDecisionDate && latestGrantDecisionDate >= latestRecoveryDate);
    const currentClosed = statusSummary.level === 'bad';
    const currentNoOpposition = /granted \(no opposition\)/i.test(statusSummary.simple || '') || /no opposition filed within time limit/i.test(statusLow) || !!latestNoOpposition;
    const currentGranted = currentNoOpposition || /^granted$/i.test(statusSummary.simple || '') || /patent has been granted|the patent has been granted/i.test(statusLow) || !!latestGrantDecision;
    const currentGrantIntended = /grant intended/i.test(statusSummary.simple || '') || /grant of patent is intended|rule\s*71\(3\)|intention to grant/i.test(statusLow) || !!latestR71;
    const currentExamination = /request for examination was made|examination/.test(statusLow) && !currentClosed;
    const currentSearch = (/published|search/.test(statusLow) || !!latestSearchPublication) && !currentClosed && !currentGrantIntended && !currentGranted;

    let currentLabel = statusSummary.simple;
    let currentLevel = statusSummary.level;
    if (currentClosed && effectiveLoss) {
      const lossText = `${effectiveLoss.title || ''} ${effectiveLoss.detail || ''}`.toLowerCase();
      if (/non-entry into european phase/.test(lossText)) {
        currentLabel = 'Deemed withdrawn (non-entry)';
        currentLevel = 'bad';
      } else if (/translations of claims\/payment missing/.test(lossText)) {
        currentLabel = 'Deemed withdrawn (grant formalities)';
        currentLevel = 'bad';
      } else if (/non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(lossText)) {
        currentLabel = 'Deemed withdrawn (fees / no WO reply)';
        currentLevel = 'bad';
      } else if (/non-reply to written opinion/.test(lossText)) {
        currentLabel = 'Deemed withdrawn (no WO reply)';
        currentLevel = 'bad';
      }
    } else if (currentNoOpposition) {
      currentLabel = 'Granted (no opposition)';
      currentLevel = 'ok';
    } else if (currentGranted) {
      currentLabel = 'Granted';
      currentLevel = 'ok';
    } else if (currentGrantIntended) {
      currentLabel = 'Grant intended (R71(3))';
      currentLevel = 'warn';
    } else if (currentExamination) {
      currentLabel = 'Examination';
      currentLevel = 'info';
    } else if (currentSearch) {
      currentLabel = 'Search';
      currentLevel = 'info';
    }

    let note = '';
    if (recoveredBeforeGrant) {
      note = `Recovered from earlier ${postureLossLabel(effectiveLoss)} via ${postureRecoveryLabel(latestRecovery)} before grant.`;
    } else if (recovered) {
      note = `Recovered from earlier ${postureLossLabel(effectiveLoss)} via ${postureRecoveryLabel(latestRecovery)}.`;
    } else if (currentClosed && effectiveLoss) {
      note = `Current controlling posture is ${postureLossLabel(effectiveLoss)}.`;
    } else if (currentGrantIntended && latestR71) {
      note = 'Current controlling posture is Rule 71(3) / intention-to-grant.';
    } else if (currentNoOpposition) {
      note = 'Current controlling posture is granted with the opposition period closed.';
    } else if (currentGranted) {
      note = 'Current controlling posture is granted / post-grant.';
    } else if (currentExamination) {
      note = 'Current controlling posture is active examination.';
    } else if (currentSearch) {
      note = 'Current controlling posture is search / publication stage.';
    }

    return {
      label: currentLabel,
      level: currentLevel,
      currentLabel,
      currentLevel,
      note,
      recovered,
      recoveredBeforeGrant,
      currentClosed,
      currentGranted,
      currentNoOpposition,
      currentGrantIntended,
      currentExamination,
      currentSearch,
      latestLoss: effectiveLoss,
      latestRecovery,
      latestGrantDecision,
      latestNoOpposition,
      latestR71,
    };
  }

  function pdfHintsWithParsedDates(pdfData = {}) {
    return (Array.isArray(pdfData?.hints) ? pdfData.hints : [])
      .map((h) => ({
        ...h,
        date: parseDateString(h.dateStr),
      }))
      .filter((h) => h.date);
  }

  function isTerminalEpoOutcomeText(textValue = '') {
    return /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|communication under rule\s*112\(1\)|rule\s*112\(1\)|application refused|application rejected|revoked|revocation|not maintained|rights restored refused|re-establishment.*rejected/.test(String(textValue || '').toLowerCase());
  }

  function isActualGrantMentionText(textValue = '') {
    const low = normalize(textValue).toLowerCase();
    if (!low) return false;
    if (/request for grant/.test(low)) return false;
    return /publication of (?:the )?mention of grant|mention of grant|european patent granted|patent has been granted|the patent has been granted|\bpatent granted\b/.test(low);
  }

  function buildDeadlineComputationContext(main, docs, eventHistory = {}, legal = {}, pdfData = {}) {
    const out = [];
    const records = buildDeadlineRecords(docs, eventHistory, legal);
    const pdfHints = pdfHintsWithParsedDates(pdfData);
    const appType = normalize(main.applicationType || '').toLowerCase();
    const isEuroPct = /e\/pct/.test(appType);
    const isDivisional = /divisional/.test(appType);
    const priorityDate = main.priorities?.[0] ? parseDateString(main.priorities[0].dateStr) : null;
    const filingDate = parseDateString(main.filingDate);

    const latestRecord = (regex) => records.find((r) => regex.test(`${r.title || ''} ${r.detail || ''}`));
    const hasPdfHint = (regex) => pdfHints.some((h) => regex.test(String(h.label || '')));
    const hasAfter = (anchorDate, predicate) => {
      const ts = anchorDate?.getTime?.() || 0;
      if (!ts) return false;
      return records.some((r) => {
        const dt = parseDateString(r.dateStr);
        return dt && dt.getTime() > ts && predicate(r, dt);
      });
    };

    const hasApplicantResponseAfter = (anchorDate, regex = /reply|response|observations|arguments|amended|amendment|claims|request|translation|appeal/i) =>
      hasAfter(anchorDate, (r) => r.actor === 'Applicant' && regex.test(`${r.title} ${r.detail}`));

    const hasFeeSignalAfter = (anchorDate, regex = /payment|fee paid|paid|examination fee|designation fee|grant and publishing fee|grant and publication fee|renewal fee/i) =>
      hasAfter(anchorDate, (r) => regex.test(`${r.title} ${r.detail}`));

    const terminalEpoOutcomeAfter = (anchorDate, dueDate = null) => {
      const anchorTs = anchorDate?.getTime?.() || 0;
      const dueTs = dueDate?.getTime?.() || 0;
      let match = null;
      for (const r of [...records].sort((a, b) => (parseDateString(a.dateStr)?.getTime?.() || 0) - (parseDateString(b.dateStr)?.getTime?.() || 0))) {
        const dt = parseDateString(r.dateStr);
        if (!dt || r.actor !== 'EPO') continue;
        if (anchorTs && dt.getTime() <= anchorTs) continue;
        if (dueTs && dt.getTime() <= dueTs) continue;
        if (!isTerminalEpoOutcomeText(`${r.title} ${r.detail}`)) continue;
        match = { dateStr: r.dateStr, title: r.title || '', detail: r.detail || '' };
        break;
      }
      return match;
    };

    const push = (entry) => {
      if (!entry?.date || Number.isNaN(entry.date.getTime())) return;
      const dueDate = entry.date;
      const anchorDate = parseDateString(entry.sourceDate || '') || dueDate;
      const terminal = terminalEpoOutcomeAfter(anchorDate, dueDate);
      const next = { ...entry };
      if (terminal && !next.resolved) {
        next.superseded = true;
        next.supersededBy = terminal;
        next.method = normalize([next.method || '', `superseded by later EPO outcome on ${terminal.dateStr}`].filter(Boolean).join(' · '));
      }
      out.push(next);
    };

    const resolveHintByActivity = (label, anchorDate) => {
      const l = String(label || '').toLowerCase();
      if (!anchorDate) return false;

      if (/r71\(3\)|intention to grant/.test(l)) {
        return hasFeeSignalAfter(anchorDate, /grant and (?:publishing|publication) fee|claims translation|excess claims fee|rule\s*71\(6\)|amendments\/corrections|approval of text|text proposed for grant/i)
          || hasApplicantResponseAfter(anchorDate, /reply|response|amend|correction|claims|translation|approval|text proposed for grant|request for correction/i);
      }

      if (/art\.?\s*94\(3\)|communication response period/.test(l)) {
        return hasApplicantResponseAfter(anchorDate, /reply|response|observations|arguments|amend|claims|request|further processing|re-establishment/i);
      }

      if (/rule 161\/162/.test(l)) {
        return hasApplicantResponseAfter(anchorDate, /reply|response|amend|claims|observations|arguments/i)
          || hasFeeSignalAfter(anchorDate, /claims fee|fee payment received/i);
      }

      if (/rule 116/.test(l)) {
        return hasApplicantResponseAfter(anchorDate, /response|request|submission|oral proceedings|withdrawal/i);
      }

      return hasApplicantResponseAfter(anchorDate);
    };

    const addMonthsDeadline = ({ triggerRegex, label, months, level, confidence = 'medium', resolvedBy }) => {
      if (hasPdfHint(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) return;
      const rec = latestRecord(triggerRegex);
      if (!rec) return;
      const anchor = parseDateString(rec.dateStr);
      if (!anchor) return;

      const resolved = typeof resolvedBy === 'function'
        ? !!resolvedBy(anchor, rec)
        : hasApplicantResponseAfter(anchor);

      const calc = addCalendarMonthsDetailed(anchor, months);
      push({
        label,
        date: calc.date,
        level,
        confidence,
        sourceDate: rec.dateStr,
        resolved,
        method: `Heuristic: +${months} month(s) from ${rec.source.toLowerCase()} trigger`,
        rolledOver: calc.rolledOver,
        rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
      });
    };

    return {
      out,
      main,
      docs,
      records,
      pdfHints,
      isEuroPct,
      isDivisional,
      priorityDate,
      filingDate,
      push,
      latestRecord,
      hasPdfHint,
      hasAfter,
      hasApplicantResponseAfter,
      hasFeeSignalAfter,
      terminalEpoOutcomeAfter,
      resolveHintByActivity,
      addMonthsDeadline,
    };
  }

  function appendPdfDerivedDeadlines(ctx) {
    const resolveHintByActivity = ctx.resolveHintByActivity;
    for (const hint of ctx.pdfHints) {
      const label = String(hint.label || 'PDF-derived deadline');
      const sourceDate = String(hint.sourceDate || '');
      const anchor = parseDateString(sourceDate) || hint.date;
      const resolvedByActivity = resolveHintByActivity(label, anchor);
      const resolved = !!hint.resolved || resolvedByActivity;
      const baseMethod = String(hint.evidence || 'PDF parse');

      ctx.push({
        label,
        date: hint.date,
        level: String(hint.level || 'bad'),
        confidence: String(hint.confidence || 'high'),
        sourceDate,
        resolved,
        fromPdf: true,
        method: resolvedByActivity && !hint.resolved
          ? `${baseMethod} · resolved by subsequent activity`
          : baseMethod,
      });
    }
  }

  function appendCoreCommunicationDeadlines(ctx) {
    ctx.addMonthsDeadline({
      triggerRegex: /rule\s*71\(3\)|intention to grant|text intended for grant/i,
      label: 'R71(3) response period',
      months: 4,
      level: 'bad',
      confidence: 'high',
      resolvedBy: (anchor) => ctx.hasFeeSignalAfter(anchor, /grant and (?:publishing|publication) fee|claims translation|excess claims fee|rule\s*71\(6\)|amendments\/corrections/i) || ctx.hasApplicantResponseAfter(anchor),
    });

    ctx.addMonthsDeadline({
      triggerRegex: /article\s*94\(3\)|art\.\s*94\(3\)|communication from (?:the )?examining/i,
      label: 'Art. 94(3) response period',
      months: 4,
      level: 'warn',
      confidence: 'medium',
    });

    ctx.addMonthsDeadline({
      triggerRegex: /rule\s*70\(2\)|confirm.*proceed|wish to proceed|proceed further/i,
      label: 'Rule 70(2) confirmation/response period',
      months: 6,
      level: 'warn',
      confidence: 'high',
    });

    ctx.addMonthsDeadline({
      triggerRegex: /rule\s*161|rule\s*162|communication pursuant to rule 161|rules?\s*161.*162/i,
      label: 'Rule 161/162 response period',
      months: 6,
      level: 'bad',
      confidence: 'high',
      resolvedBy: (anchor) => ctx.hasApplicantResponseAfter(anchor, /reply|response|amend|claims|observations|arguments/i) || ctx.hasFeeSignalAfter(anchor, /claims fee|fee payment received/i),
    });
  }

  function appendDirectOrPctDeadlines(ctx) {
    if (!ctx.isEuroPct) {
      const esrMention = ctx.latestRecord(/mention of publication of (?:the )?european search report|publication of (?:the )?european search report/i);
      if (esrMention) {
        const anchor = parseDateString(esrMention.dateStr);
        if (anchor) {
          const calc = addCalendarMonthsDetailed(anchor, 6);
          ctx.push({
            label: `${ctx.isDivisional ? 'Divisional ' : ''}exam/designation + search-opinion bundle`,
            date: calc.date,
            level: 'bad',
            confidence: 'high',
            sourceDate: esrMention.dateStr,
            resolved: ctx.hasFeeSignalAfter(anchor, /request for examination|examination fee|designation fee|extension fee|validation fee|fee payment received/i) || ctx.hasApplicantResponseAfter(anchor),
            method: 'Rule-based: +6 months from ESR publication mention',
            rolledOver: calc.rolledOver,
            rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
          });
        }
      }
      return;
    }

    const base31Date = ctx.priorityDate || ctx.filingDate;
    if (!base31Date) return;

    const calc31 = addCalendarMonthsDetailed(base31Date, 31);
    const due31 = calc31.date;
    const isr = ctx.latestRecord(/international search report|\bisr\b|written opinion/i);
    const isrDate = parseDateString(isr?.dateStr || '');
    const calcIsr = isrDate ? addCalendarMonthsDetailed(isrDate, 6) : null;
    const isrPlus6 = calcIsr?.date || null;
    const dueLater = isrPlus6 && isrPlus6 > due31 ? isrPlus6 : due31;
    const dueLaterRolled = isrPlus6 && isrPlus6 > due31 ? !!calcIsr?.rolledOver : calc31.rolledOver;
    const dueLaterRollNote = isrPlus6 && isrPlus6 > due31
      ? (calcIsr?.rolledOver ? `day ${calcIsr.fromDay}→${calcIsr.toDay}` : '')
      : (calc31.rolledOver ? `day ${calc31.fromDay}→${calc31.toDay}` : '');

    ctx.push({
      label: 'Euro-PCT entry acts (31-month stop)',
      date: due31,
      level: 'bad',
      confidence: 'high',
      sourceDate: ctx.priorityDate ? ctx.main.priorities?.[0]?.dateStr || '' : ctx.main.filingDate || '',
      resolved: ctx.hasFeeSignalAfter(base31Date, /translation|entry into european phase|rule 159|filing fee|page fee|request for examination/i),
      method: 'Rule-based: priority/filing date +31 months',
      rolledOver: calc31.rolledOver,
      rolloverNote: calc31.rolledOver ? `day ${calc31.fromDay}→${calc31.toDay}` : '',
    });

    ctx.push({
      label: 'Euro-PCT exam/designation deadline (later-of formula)',
      date: dueLater,
      level: 'bad',
      confidence: isrDate ? 'high' : 'medium',
      sourceDate: isrDate ? `${formatDate(base31Date)} / ${isr?.dateStr || ''}` : formatDate(base31Date),
      resolved: ctx.hasFeeSignalAfter(base31Date, /request for examination|examination fee|designation fee|extension fee|validation fee/i),
      method: isrDate ? 'Rule-based: max(31 months from priority/filing, ISR +6 months)' : 'Rule-based: 31 months from priority/filing (ISR date unavailable)',
      rolledOver: dueLaterRolled,
      rolloverNote: dueLaterRollNote,
    });
  }

  function appendPostGrantDeadlines(ctx) {
    const grantMention = ctx.records.find((record) => isActualGrantMentionText(`${record.title || ''} ${record.detail || ''}`));
    if (grantMention) {
      const anchor = parseDateString(grantMention.dateStr);
      if (anchor) {
        const calcOpp = addCalendarMonthsDetailed(anchor, 9);
        ctx.push({
          label: 'Opposition period (third-party monitor)',
          date: calcOpp.date,
          level: 'warn',
          confidence: 'high',
          sourceDate: grantMention.dateStr,
          resolved: false,
          method: 'Rule-based: grant mention +9 months',
          rolledOver: calcOpp.rolledOver,
          rolloverNote: calcOpp.rolledOver ? `day ${calcOpp.fromDay}→${calcOpp.toDay}` : '',
        });
        const calcUe = addCalendarMonthsDetailed(anchor, 1);
        ctx.push({
          label: 'Unitary effect request window',
          date: calcUe.date,
          level: 'warn',
          confidence: 'high',
          sourceDate: grantMention.dateStr,
          resolved: ctx.hasAfter(anchor, (r) => /unitary effect/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: grant mention +1 month',
          rolledOver: calcUe.rolledOver,
          rolloverNote: calcUe.rolledOver ? `day ${calcUe.fromDay}→${calcUe.toDay}` : '',
        });
      }
    }

    const decision = ctx.latestRecord(/\bdecision\b.*(?:refus|grant|revok|maintain)|\bdecision\b/i);
    if (decision) {
      const anchor = parseDateString(decision.dateStr);
      if (anchor) {
        const calcNotice = addCalendarMonthsDetailed(anchor, 2);
        ctx.push({
          label: 'Appeal notice + fee',
          date: calcNotice.date,
          level: 'bad',
          confidence: 'high',
          sourceDate: decision.dateStr,
          resolved: ctx.hasAfter(anchor, (r) => /notice of appeal|appeal fee/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: decision date +2 months',
          rolledOver: calcNotice.rolledOver,
          rolloverNote: calcNotice.rolledOver ? `day ${calcNotice.fromDay}→${calcNotice.toDay}` : '',
        });
        const calcGrounds = addCalendarMonthsDetailed(anchor, 4);
        ctx.push({
          label: 'Appeal grounds',
          date: calcGrounds.date,
          level: 'bad',
          confidence: 'high',
          sourceDate: decision.dateStr,
          resolved: ctx.hasAfter(anchor, (r) => /grounds of appeal|statement of grounds/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: decision date +4 months',
          rolledOver: calcGrounds.rolledOver,
          rolloverNote: calcGrounds.rolledOver ? `day ${calcGrounds.fromDay}→${calcGrounds.toDay}` : '',
        });
      }
    }
  }

  function appendReferenceDeadlines(ctx) {
    if (ctx.priorityDate) {
      const calcPriority = addCalendarMonthsDetailed(ctx.priorityDate, 12);
      const due = calcPriority.date;
      if (due > new Date()) {
        ctx.push({
          label: 'Priority year ends',
          date: due,
          level: 'warn',
          confidence: 'high',
          sourceDate: ctx.main.priorities?.[0]?.dateStr || '',
          resolved: false,
          method: 'Rule-based: earliest priority date +12 months',
          rolledOver: calcPriority.rolledOver,
          rolloverNote: calcPriority.rolledOver ? `day ${calcPriority.fromDay}→${calcPriority.toDay}` : '',
        });
      }
    }

    if (ctx.filingDate) {
      const calcTerm = addCalendarMonthsDetailed(ctx.filingDate, 12 * 20);
      ctx.push({
        label: '20-year term from filing (reference)',
        date: calcTerm.date,
        level: 'info',
        confidence: 'high',
        reference: true,
        resolved: false,
        method: 'Rule-based: filing date +20 years',
        rolledOver: calcTerm.rolledOver,
        rolloverNote: calcTerm.rolledOver ? `day ${calcTerm.fromDay}→${calcTerm.toDay}` : '',
      });
    }
  }

  function inferProceduralDeadlines(main, docs, eventHistory = {}, legal = {}, pdfData = {}) {
    const ctx = buildDeadlineComputationContext(main, docs, eventHistory, legal, pdfData);
    appendPdfDerivedDeadlines(ctx);
    appendCoreCommunicationDeadlines(ctx);
    appendDirectOrPctDeadlines(ctx);
    appendPostGrantDeadlines(ctx);
    appendReferenceDeadlines(ctx);
    return dedupe(ctx.out, (d) => `${d.label}|${formatDate(d.date)}|${d.sourceDate || ''}`);
  }


  function inferRenewalModel(main, legal, ue) {
    const now = new Date();
    const renewals = legal.renewals || [];
    const mentionGrant = (legal.events || []).find((e) => isActualGrantMentionText(`${e.title} ${e.detail}`));
    const ueRegistered = /unitary effect registered/i.test(ue.ueStatus || ue.statusRaw || '');
    const filingDate = parseDateString(main.filingDate);
    const highestYear = renewals.reduce((m, r) => (r.year && r.year > m ? r.year : m), 0) || null;

    let feeForum = 'Unknown';
    if (ueRegistered) feeForum = 'EPO central (Unitary Patent)';
    else if (mentionGrant) feeForum = 'National offices (post-grant EP bundle)';
    else if (filingDate) feeForum = 'EPO central (pre-grant EP application)';

    let nextYear = null;
    let nextDue = null;
    let graceUntil = null;
    let dueState = 'unknown';
    let confidence = 'low';

    const canUseCentralEpSchedule = !!filingDate && (ueRegistered || !mentionGrant);
    if (canUseCentralEpSchedule) {
      if (highestYear) {
        nextYear = highestYear + 1;
        confidence = 'high';
      } else {
        for (let y = 3; y <= 40; y++) {
          const due = epRenewalDueDate(filingDate, y);
          if (!due) continue;
          const grace = addMonths(due, 6);
          if (grace.getTime() >= now.getTime() - 86400000) {
            nextYear = y;
            break;
          }
        }
        if (!nextYear) nextYear = 40;
        confidence = 'medium';
      }

      nextDue = epRenewalDueDate(filingDate, nextYear);
      graceUntil = nextDue ? addMonths(nextDue, 6) : null;

      if (nextDue) {
        if (now.getTime() <= nextDue.getTime()) dueState = 'upcoming';
        else if (graceUntil && now.getTime() <= graceUntil.getTime()) dueState = 'grace';
        else dueState = 'overdue';
      }
    }

    const mode = ueRegistered
      ? 'Unitary patent renewal fees are payable centrally at the EPO; due dates follow the EP filing-anniversary month schedule.'
      : mentionGrant
        ? 'After mention of grant, renewal timing generally shifts to designated national offices (unless unitary effect applies).'
        : 'Pre-grant EP renewal fees are centrally payable at the EPO from patent year 3 onward.';

    return {
      count: renewals.length,
      latest: renewals[0] || null,
      highestYear,
      explanatoryBasis: mode,
      mentionGrantDate: mentionGrant?.dateStr || '',
      isUnitary: ueRegistered,
      feeForum,
      nextYear,
      nextDue,
      graceUntil,
      dueState,
      confidence,
    };
  }

  function isMonitoringDeadline(deadline = {}) {
    const label = normalize(deadline?.label || '').toLowerCase();
    return /opposition period/.test(label) || /third-party monitor/.test(label);
  }

  function deadlinePresentationBuckets(deadlines = [], currentClosedPosture = false) {
    const buckets = { active: [], monitoring: [], historical: [] };
    for (const deadline of (deadlines || [])) {
      if (deadline?.reference) continue;
      if (currentClosedPosture) {
        buckets.historical.push(deadline);
        continue;
      }
      if (deadline?.resolved || deadline?.superseded) {
        buckets.historical.push(deadline);
        continue;
      }
      if (isMonitoringDeadline(deadline)) {
        buckets.monitoring.push(deadline);
        continue;
      }
      buckets.active.push(deadline);
    }
    for (const key of Object.keys(buckets)) buckets[key].sort((a, b) => a.date - b.date);
    return buckets;
  }

  function selectNextDeadline(deadlines = [], currentClosedPosture = false, now = new Date()) {
    const actionable = deadlinePresentationBuckets(deadlines, currentClosedPosture).active;
    if (!actionable.length) return null;
    const upcoming = actionable.find((d) => d.date > now);
    if (upcoming) return upcoming;
    if (currentClosedPosture) return null;
    return actionable[0] || null;
  }

  function activeDeadlineNoteText(deadlines = [], currentClosedPosture = false, posture = null) {
    const buckets = deadlinePresentationBuckets(deadlines, currentClosedPosture);
    if (buckets.active.length && currentClosedPosture) {
      return 'No active procedural deadline detected on the current withdrawn/closed posture; remaining clocks are historical, appellate, or low-confidence.';
    }
    if (buckets.active.length) return '';
    if (buckets.monitoring.length) {
      return 'No active applicant/EPO deadline detected; remaining clocks are third-party monitoring windows.';
    }
    if (buckets.historical.some((d) => d.superseded) && currentClosedPosture) {
      return 'No active procedural deadline detected; later loss-of-rights events superseded earlier response periods.';
    }
    if (buckets.historical.some((d) => d.resolved)) {
      return posture?.recovered
        ? 'No active procedural deadline detected; earlier response periods appear answered and the case later recovered from an adverse posture.'
        : 'No active procedural deadline detected; earlier response periods appear already answered.';
    }
    return currentClosedPosture ? 'No active procedural deadline detected on the current withdrawn/closed posture.' : '';
  }

  function upcUePresentationModel(ue = {}, upcRegistry = null, federated = {}) {
    const ueStatusRaw = normalize(ue.ueStatus || ue.statusRaw || '');
    const federatedStatus = normalize(federated.status || '');
    const coverageStates = normalize(ue.memberStates || federated.upMemberStates || '');
    const hasUpCoverage = !!coverageStates;
    const hasUnitaryEffectRecord = hasUpCoverage || /unitary effect|request for unitary effect|ue requested|unitary patent|unitary protection/i.test(ueStatusRaw);
    const mirrorsFederatedStatus = ueStatusRaw && federatedStatus && ueStatusRaw === federatedStatus;
    const looksLikeOverallStatus = ueStatusRaw && !hasUnitaryEffectRecord && (
      /^(the )?(application|patent)\b/i.test(ueStatusRaw)
      || /request for examination was made/i.test(ueStatusRaw)
      || /grant of patent is intended/i.test(ueStatusRaw)
      || /decision to grant/i.test(ueStatusRaw)
      || /no opposition filed within time limit/i.test(ueStatusRaw)
    );
    const unitaryEffect = hasUnitaryEffectRecord
      ? ueStatusRaw
      : (mirrorsFederatedStatus || looksLikeOverallStatus)
        ? 'No unitary effect record'
        : (ueStatusRaw || 'Unknown');
    const upcRegistryStatus = upcRegistry
      ? (upcRegistry.status || (upcRegistry.optedOut ? 'Opted out' : 'No opt-out found'))
      : (ue.upcOptOut || 'Unknown');

    return {
      unitaryEffect,
      upcRegistryStatus,
      note: upcRegistryNoteText(upcRegistry, ue),
    };
  }

  function overviewCacheKey(caseNo, opts, c) {
    const optPart = [
      opts.showRenewals,
      opts.showUpcUe,
      opts.showCitations,
      opts.showPublications,
      opts.showEventHistory,
      opts.showLegalStatusRows,
    ].join('|');

    const srcPart = ['main', 'doclist', 'event', 'family', 'legal', 'federated', 'citations', 'ueMain', 'upcRegistry', 'pdfDeadlines']
      .map((k) => sourceStamp(c, k))
      .join('|');
    return `${caseNo}|${optPart}|${srcPart}`;
  }

  function overviewModel(caseNo) {
    const { c, main, legal, federated, citations, eventHistory, ue, upcRegistry, pdfDeadlines, docs, publications } = caseSnapshot(caseNo);
    const opts = options();
    const cacheKey = overviewCacheKey(caseNo, opts, c);
    if (runtime.overviewCache.key === cacheKey && runtime.overviewCache.model) {
      return runtime.overviewCache.model;
    }

    const latestEpo = docs.find((d) => d.actor === 'EPO' && d.bundle !== 'Other') || docs.find((d) => d.actor === 'EPO') || null;
    const applicantDocs = docs.filter((d) => d.actor === 'Applicant');
    const latestApplicant = applicantDocs.find((d) => d.bundle !== 'Other') || applicantDocs[0] || null;
    const partialState = overviewPartialState(c);

    const storedStatusRaw = c.meta?.lastMainStatusRaw || '';
    const statusSummary = summarizeStatus(main.statusRaw || storedStatusRaw);
    const stageText = normalize(main.statusRaw || storedStatusRaw).toLowerCase();
    const statusStage = main.statusStage || c.meta?.lastMainStage || inferStatusStage(stageText);
    const mainSourceStatus = String(c.sources.main?.status || '').toLowerCase();
    const mainUnavailable = mainSourceStatus === 'notfound' || mainSourceStatus === 'empty';

    const stage = mainUnavailable
      ? 'Unavailable'
      : (statusStage
        || (docs.some((d) => d.bundle === 'Grant package')
          ? 'Grant / post-grant'
          : docs.some((d) => d.bundle === 'Examination')
            ? 'Examination'
            : docs.some((d) => d.bundle === 'Search package')
              ? 'Search'
              : docs.some((d) => d.bundle === 'Filing package')
                ? 'Filing'
                : 'Unknown'));

    const deadlines = inferProceduralDeadlines(main, docs, eventHistory, legal, pdfDeadlines);
    const posture = proceduralPostureModel(main, docs, eventHistory, legal);

    const renewal = inferRenewalModel(main, legal, ue);

    const latestEpoDate = parseDateString(latestEpo?.dateStr);
    const latestApplicantDate = parseDateString(latestApplicant?.dateStr);
    const latestRecoveryDate = postureRecordDate(posture.latestRecovery);
    const applicantAfterRecovery = !!(latestRecoveryDate && latestApplicantDate && latestApplicantDate >= latestRecoveryDate);
    const applicantAfterLatestEpo = !!(latestEpoDate && latestApplicantDate && latestApplicantDate > latestEpoDate);

    const waitingOn = posture.currentClosed
      ? (applicantAfterLatestEpo ? 'EPO recovery outcome' : 'No active step')
      : posture.recovered && applicantAfterRecovery
        ? 'EPO recovery outcome'
        : (latestApplicantDate && (!latestEpoDate || latestApplicantDate > latestEpoDate) ? 'EPO' : 'Applicant');

    const waitingDays = waitingOn === 'EPO' && latestApplicantDate
      ? Math.floor((Date.now() - latestApplicantDate.getTime()) / 86400000)
      : waitingOn === 'EPO recovery outcome' && latestApplicantDate
        ? Math.floor((Date.now() - latestApplicantDate.getTime()) / 86400000)
        : null;

    const recoveryAction = recoveryActionModel(posture, waitingOn, waitingDays, latestApplicant);
    const recoveryOptions = recoveryAction?.note || '';

    const nextDeadline = selectNextDeadline(deadlines, posture.currentClosed);
    const nextDeadlineNote = activeDeadlineNoteText(deadlines, posture.currentClosed, posture);
    const daysToDeadline = nextDeadline ? Math.ceil((nextDeadline.date.getTime() - Date.now()) / 86400000) : null;

    const federatedStates = Array.isArray(federated.states) ? federated.states : [];
    const federatedNotableStates = Array.isArray(federated.notableStates) ? federated.notableStates : [];
    const citationEntries = Array.isArray(citations.entries) ? citations.entries : [];
    const citationPhases = Array.isArray(citations.phases) ? citations.phases : [];
    const familyRole = familyRoleSummary({
      applicationType: main.applicationType || parseApplicationType(main),
      parentCase: main.parentCase || '',
      divisionalChildren: main.divisionalChildren || [],
    });

    const model = {
      title: main.title || (mainSourceStatus === 'notfound' ? 'No Register file found' : '—'),
      applicant: main.applicant || '—',
      representative: main.representative || '—',
      appNo: caseNo,
      filingDate: main.filingDate || '—',
      priority: main.priorityText || '—',
      stage,
      status: mainSourceStatus === 'notfound'
        ? 'No Register file found for this application number.'
        : mainSourceStatus === 'empty'
          ? 'Main tab returned no usable case data.'
          : (main.statusRaw || storedStatusRaw || '—').split('\n')[0],
      posture,
      statusSimple: mainSourceStatus === 'notfound'
        ? 'Not found'
        : mainSourceStatus === 'empty'
          ? 'No main data'
          : statusSummary.simple,
      statusLevel: mainSourceStatus === 'notfound'
        ? 'bad'
        : mainSourceStatus === 'empty'
          ? 'warn'
          : statusSummary.level,
      applicationType: mainUnavailable ? 'Unavailable' : (main.applicationType || parseApplicationType(main)),
      familyRole,
      parentCase: mainUnavailable ? '' : (main.parentCase || ''),
      divisionalChildren: mainUnavailable ? [] : (main.divisionalChildren || []),
      latestEpo,
      latestApplicant,
      partialState,
      waitingOn,
      waitingDays,
      recoveryAction,
      recoveryOptions,
      nextDeadline,
      nextDeadlineNote,
      daysToDeadline,
      publications,
      deadlines: deadlines.sort((a, b) => a.date - b.date),
      renewal,
      federated: {
        status: federated.status || '',
        upMemberStates: federated.upMemberStates || '',
        invalidationDate: federated.invalidationDate || '',
        renewalFeesPaidUntil: federated.renewalFeesPaidUntil || '',
        recordUpdated: federated.recordUpdated || '',
        trackedStates: federatedStates.length,
        notableStates: federatedNotableStates.slice(0, 6),
      },
      citations: {
        entries: citationEntries,
        phases: citationPhases,
      },
      upcUe: upcUePresentationModel(ue, upcRegistry, federated),
    };

    runtime.overviewCache = { key: cacheKey, model };
    return model;
  }

  function topLevel(levels) {
    if (levels.includes('bad')) return 'bad';
    if (levels.includes('warn')) return 'warn';
    if (levels.includes('ok')) return 'ok';
    return 'info';
  }

  const TIMELINE_LEVEL_RULES = Object.freeze([
    {
      level: 'bad',
      test: (low) => /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|rule\s*112\(1\)|application refused|application rejected|revoked|revocation|lapsed|not maintained|request for re-establishment.*rejected|rights restored refused|withdrawn by applicant|deemed withdrawn/.test(low),
    },
    {
      level: 'warn',
      test: (low) => /deadline|time limit|final date|summons to oral proceedings|rule\s*116|article\s*94\(3\)|art\.?\s*94\(3\)|rule\s*71\(3\)|intention to grant|communication from the examining|communication under|opposition|third party observations|request for re-establishment|further processing/.test(low),
    },
    {
      level: 'ok',
      test: (low) => /mention of grant|patent granted|grant decision|fee paid|renewal paid|annual fee paid|validation|registered|recorded/.test(low),
    },
  ]);

  function timelineAttorneyImportance(title, detail = '', source = '', actor = 'Other', baseLevel = 'info') {
    const base = ['bad', 'warn', 'ok', 'info'].includes(baseLevel) ? baseLevel : 'info';
    const low = normalize(`${title || ''}\n${detail || ''}\n${source || ''}\n${actor || ''}`).toLowerCase();
    for (const rule of TIMELINE_LEVEL_RULES) {
      if (rule.test(low)) return rule.level;
      if (base === rule.level) return rule.level;
    }
    return 'info';
  }

  function sourceStamp(c, key) {
    const src = c?.sources?.[key] || {};
    return `${key}:${src.status || 'na'}:${src.fetchedAt || 0}:${src.parserVersion || ''}:${src.dependencyStamp || ''}`;
  }

  function timelineCacheKey(caseNo, opts, c) {
    const optPart = [
      opts.showEventHistory,
      opts.showLegalStatusRows,
      opts.showPublications,
      opts.timelineEventLevel,
      opts.timelineLegalLevel,
      opts.timelineMaxEntries,
    ].join('|');

    const srcPart = ['main', 'doclist', 'event', 'family', 'legal', 'pdfDeadlines'].map((k) => sourceStamp(c, k)).join('|');
    return `${caseNo}|${optPart}|${srcPart}`;
  }

  function docModelPdfCategory(model, pdfDeadlines = {}) {
    const scanned = Array.isArray(pdfDeadlines?.scanned) ? pdfDeadlines.scanned : [];
    if (!scanned.length || !model) return '';
    const modelDate = normalizeDateString(model.dateStr || '');
    const modelTitle = normalize(model.title || '').toLowerCase();
    const exact = scanned.find((entry) => normalizeDateString(entry?.dateStr || '') === modelDate && normalize(entry?.title || '').toLowerCase() === modelTitle && normalize(entry?.category || ''));
    if (exact?.category) return String(exact.category);
    const sameDate = scanned.find((entry) => normalizeDateString(entry?.dateStr || '') === modelDate && normalize(entry?.category || ''));
    return String(sameDate?.category || '');
  }

  function genericDocLabel(model = {}, pdfDeadlines = {}) {
    const title = normalize(model.title || '').toLowerCase();
    const bundle = String(model.groupKind || model.bundle || '');
    const pdfLabel = pdfCategoryBundleLabel(docModelPdfCategory(model, pdfDeadlines), bundle);
    if (pdfLabel) return pdfLabel;
    const signal = normalizedDocSignal(model.title || '', model.procedure || '');
    if (signal?.bundle) return signal.bundle;
    if (/examination started|examining division becomes responsible|request for examination filed/.test(title)) return 'Examination milestone';
    if (/notification of forthcoming publication|publication in section/i.test(title)) return 'Publication formalities';
    if (/communication to designated inventor/.test(title)) return 'Inventor notification';
    if (/search started/.test(title)) return 'Search milestone';
    if (/communication of amended entries concerning the representative|submission concerning change of applicant'?s representative/.test(title)) return 'Representative change filings';
    if (bundle === 'Examination') return 'Examination communication';
    if (bundle === 'Other') return 'Formalities / other';
    return '';
  }

  function timelineDocDetail(model, groupLabel = '', pdfDeadlines = {}) {
    const genericLabel = genericDocLabel(model, pdfDeadlines);
    const procedure = normalize(model.procedure || '');
    const broadGroupLabel = /^(examination|other|formalities \/ other)$/i.test(normalize(groupLabel));
    const bits = [];
    if (genericLabel && genericLabel !== groupLabel) bits.push(genericLabel);
    if (groupLabel && !(genericLabel && broadGroupLabel)) bits.push(groupLabel);
    if (!bits.length && procedure) bits.push(procedure);
    if (bits.length > 1) {
      return bits.filter((bit) => !/^(search \/ examination|all documents)$/i.test(bit)).filter((bit, idx, arr) => arr.findIndex((other) => other.toLowerCase() === bit.toLowerCase()) === idx).join(' · ');
    }
    return bits[0] || procedure || 'All documents';
  }

  const PACKET_EXPLANATION_MAP = Object.freeze({
    'international search / iprp': 'ISA/IPRP packet from the international phase.',
    'partial international search': 'Partial international search packet with the provisional opinion/search results.',
    'european search package': 'European search report packet, including ESR opinion/strategy where present.',
    'extended european search package': 'European search packet including an extended-ESR annex.',
    'supplementary european search package': 'Supplementary European search packet for Euro-PCT regional phase entry.',
    'intention to grant (r71(3) epc)': 'Rule 71(3) grant-intention packet, including text-for-grant documents.',
    'response to intention to grant': 'Applicant response packet to the Rule 71(3) / grant-intention communication.',
    'grant decision': 'Formal grant decision from the EPO.',
    'further processing': 'Recovery packet showing further processing after a missed time limit.',
    'euro-pct non-entry failure': 'Loss-of-rights packet showing failure to complete Euro-PCT entry acts in time.',
    'grant-formalities failure': 'Loss-of-rights packet caused by missing grant-formality acts or payments.',
    'fees / written-opinion failure': 'Loss-of-rights packet caused by fee non-payment and/or no reply to the written opinion.',
    'written-opinion loss': 'Loss-of-rights packet caused by no reply to the written opinion.',
  });

  function docPacketExplanation(label = '') {
    return PACKET_EXPLANATION_MAP[normalize(label).toLowerCase()] || '';
  }

  function timelineSubtitleText(item = {}) {
    const detailBits = String(item.detail || '')
      .split(/\s*(?:·|\n)+\s*/)
      .map((bit) => normalize(bit))
      .filter(Boolean);
    const actor = normalize(item.actor || '');
    const explanation = normalize(item.explanation || '');
    const bits = [...detailBits, explanation, normalize(item.source || ''), actor && actor !== 'Other' ? actor : '']
      .filter(Boolean)
      .filter((bit, idx, arr) => arr.findIndex((other) => other.toLowerCase() === bit.toLowerCase()) === idx);
    return bits.join(' · ');
  }

  function shouldAppendSingleRunLabel(itemDetail = '', groupLabel = '') {
    const detail = normalize(itemDetail).toLowerCase();
    const label = normalize(groupLabel).toLowerCase();
    if (!label) return false;
    if (!detail) return true;
    if (detail.includes(label)) return false;
    if (/^(examination|other|formalities \/ other)$/i.test(groupLabel)) return false;
    return true;
  }

  function timelineDocItemsFromDocs(caseNo, docs = [], pdfDeadlines = {}) {
    const groupableBundles = new Set(['Search package', 'Grant communication', 'Grant response', 'Examination communication', 'Examination response', 'Examination', 'Filing package', 'Applicant filings', 'Response to search']);
    const runs = doclistRuns(normalizeDoclistGroupKinds(normalizeGrantPackageRowModels(doclistDocModels(docs))));
    const out = [];

    const timelineItemFromDocModel = (model, groupLabel = '') => {
      const actor = model.actor || 'Other';
      const detail = timelineDocDetail(model, groupLabel, pdfDeadlines);
      return {
        type: 'item',
        dateStr: model.dateStr,
        title: model.title,
        detail,
        source: 'Documents',
        level: timelineAttorneyImportance(model.title, detail, 'Documents', actor, model.level || 'info'),
        actor,
        url: model.url,
      };
    };

    for (const run of runs) {
      const groupLabel = doclistRunLabel(run, pdfDeadlines);
      const runItems = (run.models || []).map((model) => timelineItemFromDocModel(model, groupLabel));
      const actorSet = [...new Set(runItems.map((item) => item.actor).filter(Boolean))].filter((actor) => actor !== 'Other');
      const actor = actorSet.length === 1 ? actorSet[0] : (actorSet.length > 1 ? 'Mixed' : (runItems[0]?.actor || 'Other'));
      const runLevel = topLevel(runItems.map((item) => item.level));
      const shouldGroup = groupableBundles.has(run.bundle) && runItems.length >= 2;

      if (!shouldGroup) {
        runItems.forEach((item) => {
          item.detail = [item.detail, groupableBundles.has(run.bundle) && shouldAppendSingleRunLabel(item.detail, groupLabel) ? groupLabel : '']
            .filter(Boolean)
            .filter((bit, idx, arr) => arr.findIndex((other) => other.toLowerCase() === bit.toLowerCase()) === idx)
            .join(' · ');
          out.push(item);
        });
        continue;
      }

      out.push({
        type: 'group',
        _key: `${run.dateStr || 'nodate'}|${run.bundle}|${actor}`,
        dateStr: run.dateStr,
        title: groupLabel,
        source: 'Documents',
        level: runLevel,
        actor,
        explanation: docPacketExplanation(groupLabel),
        items: runItems,
      });
    }

    return out;
  }

  function upcRegistryNoteText(upcRegistry, ue = {}) {
    if (upcRegistry) {
      const checked = [upcRegistry.patentNumber, ...(Array.isArray(upcRegistry.patentNumbers) ? upcRegistry.patentNumbers : [])]
        .map((value) => normalize(String(value || '')))
        .filter(Boolean);
      const unique = [...new Set(checked)];
      if (unique.length === 1) return `Registry checked for ${unique[0]}.`;
      if (unique.length > 1) return `Registry checked for ${unique.join(', ')}.`;
      return 'Registry queried against EP publication candidates.';
    }
    return ue.ueStatus
      ? 'Taken from UP/legal data where available.'
      : 'No cached UP/UPC data yet.';
  }

  function timelineModel(caseNo) {
    const opts = options();
    const { c, main, eventHistory, legal, docs, publications, pdfDeadlines } = caseSnapshot(caseNo);
    const cacheKey = timelineCacheKey(caseNo, opts, c);
    if (runtime.timelineCache.key === cacheKey && Array.isArray(runtime.timelineCache.items)) {
      return runtime.timelineCache.items;
    }

    const items = [];

    for (const e of main.recentEvents || []) {
      const detail = [e.detail, 'Main page'].filter(Boolean).join('\n');
      items.push({
        type: 'item',
        dateStr: e.dateStr,
        title: e.title,
        detail,
        source: 'Main',
        level: timelineAttorneyImportance(e.title, detail, 'Main', 'EPO', 'info'),
        actor: 'EPO',
        url: sourceUrl(caseNo, 'main'),
      });
    }

    items.push(...timelineDocItemsFromDocs(caseNo, docs, pdfDeadlines));

    if (opts.showEventHistory) {
      for (const e of eventHistory.events || []) {
        const detail = normalize(e.detail || '');
        items.push({
          type: 'item',
          dateStr: e.dateStr,
          title: e.title,
          detail,
          source: 'Event history',
          level: timelineAttorneyImportance(e.title, detail, 'Event history', 'EPO', opts.timelineEventLevel || 'info'),
          actor: 'EPO',
          url: e.url || sourceUrl(caseNo, 'event'),
        });
      }
    }

    if (opts.showLegalStatusRows) {
      for (const e of legal.events || []) {
        const detail = normalize(e.detail || '');
        items.push({
          type: 'item',
          dateStr: e.dateStr,
          title: e.title,
          detail,
          source: 'Legal status',
          level: timelineAttorneyImportance(e.title, detail, 'Legal status', 'EPO', opts.timelineLegalLevel || 'warn'),
          actor: 'EPO',
          url: e.url || sourceUrl(caseNo, 'legal'),
        });
      }
    }

    if (opts.showPublications) {
      for (const p of publications) {
        const title = `${p.no}${p.kind || ''} publication`;
        const detail = p.role || 'Publication';
        items.push({
          type: 'item',
          dateStr: p.dateStr,
          title,
          detail,
          source: 'Publications',
          level: timelineAttorneyImportance(title, detail, 'Publications', 'EPO', 'info'),
          actor: 'EPO',
          url: sourceUrl(caseNo, 'main'),
        });
      }
    }

    const built = dedupe(items, (i) => {
      if (i.type === 'group') return `g|${i.dateStr}|${i.title}|${(i.items || []).map((x) => `${x.title}|${x.url}`).join('||')}`;
      return `i|${i.dateStr}|${i.title}|${i.detail}|${i.url}`;
    }).sort(compareDateDesc).slice(0, opts.timelineMaxEntries);

    runtime.timelineCache = { key: cacheKey, items: built };
    return built;
  }

  const COMPACT_TITLE_EXACT_MAP = new Map([
    ['Text intended for grant (version for approval)', 'Grant text for approval'],
    ['Text intended for grant (clean copy)', 'Grant text (clean copy)'],
    ['Communication about intention to grant a European patent', 'Intention to grant'],
    ['Annex to the communication about intention to grant a European patent', 'Grant communication annex'],
    ['Bibliographic data of the European patent application', 'Bibliographic data'],
    ['Request for correction/amendment of the text proposed for grant sent from 01.04.2012', 'Grant text correction request'],
    ['Reminder period for payment of examination fee/designation fee and correction of deficiencies in Written Opinion/amendment', 'Exam / designation fee reminder'],
    ['Communication regarding the transmission of the European search report', 'Search report transmission'],
    ['Amendments received before examination', 'Amendments before examination'],
  ]);

  const COMPACT_TITLE_REPLACEMENTS = Object.freeze([
    [/\s+a European patent$/i, ''],
    [/^New entry:\s*/i, ''],
    [/^Deletion\s+-\s*/i, ''],
    [/\s+sent from 01\.04\.2012$/i, ''],
  ]);

  function compactOverviewTitle(title = '') {
    const normalized = normalize(title);
    if (!normalized) return '—';
    if (COMPACT_TITLE_EXACT_MAP.has(normalized)) return COMPACT_TITLE_EXACT_MAP.get(normalized);
    return COMPACT_TITLE_REPLACEMENTS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), normalized).trim();
  }

  function overviewLatestActionText(doc) {
    if (!doc) return '—';
    return `${doc.dateStr} · ${compactOverviewTitle(doc.title || '')}`;
  }

  function recoveryActionModel(posture = {}, waitingOn = '', waitingDays = null, latestApplicant = null) {
    const loss = posture?.latestLoss || null;
    const recovery = posture?.latestRecovery || null;
    const grant = posture?.latestGrantDecision || null;
    const cap = (text = '') => text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
    const lossText = loss ? cap(postureLossLabel(loss)) : 'Adverse posture';
    const recoveryText = recovery
      ? (compactOverviewTitle(recovery.title || recovery.detail || '') || cap(postureRecoveryLabel(recovery)))
      : '';
    const grantText = grant ? (compactOverviewTitle(grant.title || grant.detail || '') || 'Grant decision') : '';
    const applicantText = latestApplicant
      ? `${latestApplicant.dateStr || '—'} · ${compactOverviewTitle(latestApplicant.title || '')}`
      : '';

    if (posture?.recovered && recovery) {
      const summaryBits = [
        loss?.dateStr ? `${loss.dateStr} · ${lossText}` : lossText,
        recovery?.dateStr ? `${recovery.dateStr} · ${recoveryText}` : recoveryText,
        posture?.recoveredBeforeGrant && grant?.dateStr ? `${grant.dateStr} · ${grantText}` : '',
      ].filter(Boolean);
      return {
        label: 'Recovery path',
        badge: posture.recoveredBeforeGrant ? 'Recovered before grant' : 'Recovered',
        level: 'ok',
        summary: summaryBits.join(' → '),
        note: posture.recoveredBeforeGrant
          ? 'Earlier adverse posture was cured before the file returned to grant.'
          : 'Earlier adverse posture was cured and the file later returned to the active track.',
      };
    }

    if (waitingOn === 'EPO recovery outcome') {
      const summaryBits = [
        loss?.dateStr ? `${loss.dateStr} · ${lossText}` : lossText,
        applicantText,
      ].filter(Boolean);
      return {
        label: 'Recovery path',
        badge: 'Recovery pending',
        level: 'warn',
        summary: summaryBits.join(' → '),
        note: `Applicant appears to have responded after the adverse posture; monitor the EPO recovery outcome${waitingDays != null ? ` (${formatDaysHuman(waitingDays)} since applicant reply)` : ''}.`,
      };
    }

    if (posture?.currentClosed && loss) {
      return {
        label: 'Recovery path',
        badge: 'Recovery options',
        level: 'bad',
        summary: loss?.dateStr ? `${loss.dateStr} · ${lossText}` : lossText,
        note: 'Adverse posture detected. Check further processing first; if unavailable, consider Rule 136 re-establishment.',
      };
    }

    return null;
  }

  function renderOverviewHeaderCard(m) {
    const termReference = m.deadlines.find((d) => d.reference && /20-year term from filing/i.test(String(d.label || '')));
    const termReferenceDate = termReference?.date ? formatDate(termReference.date) : '';
    const filingSummary = normalize([
      m.filingDate ? `Filed ${m.filingDate}` : 'Filed —',
      termReferenceDate ? `20-year term ${termReferenceDate}` : '',
    ].filter(Boolean).join(' · ')) || 'Filed —';
    const partialNotice = m.partialState?.partial
      ? `<div class="epoRP-m"><span class="epoRP-bdg warn">${esc(m.partialState.summary || 'partial data')}</span> ${esc(m.partialState.note || 'Showing partial case data only.')}</div>`
      : '';

    return `<div class="epoRP-c">${partialNotice}<div class="epoRP-g">
      <div class="epoRP-l">Title</div><div class="epoRP-v">${esc(m.title)}</div>
      <div class="epoRP-l">Applicant</div><div class="epoRP-v">${esc(m.applicant)}</div>
      <div class="epoRP-l">Application #</div><div class="epoRP-v">${esc(m.appNo)}</div>
      <div class="epoRP-l">Filing date</div><div class="epoRP-v">${esc(filingSummary)}</div>
      <div class="epoRP-l">Priority</div><div class="epoRP-v">${esc(m.priority)}</div>
      <div class="epoRP-l">Type / stage</div><div class="epoRP-v">${esc(m.applicationType)} · ${esc(m.stage)}</div>
      <div class="epoRP-l">Family role</div><div class="epoRP-v">${esc(m.familyRole?.label || '—')}${m.parentCase ? ` · child of <a class="epoRP-a" href="${esc(sourceUrl(m.parentCase, 'main'))}">${esc(m.parentCase)}</a>` : ''}${m.familyRole?.note ? `<div class="epoRP-m">${esc(m.familyRole.note)}</div>` : ''}</div>
      ${m.divisionalChildren?.length ? `<div class="epoRP-l">Divisionals</div><div class="epoRP-v">${m.divisionalChildren.map((ep) => `<a class="epoRP-a" href="${esc(sourceUrl(ep, 'main'))}">${esc(ep)}</a>`).join(', ')}</div>` : ''}
      <div class="epoRP-l">Status</div><div class="epoRP-v"><span class="epoRP-bdg ${esc(m.statusLevel || 'info')}">${esc(m.statusSimple || 'Unknown')}</span><div class="epoRP-m">${esc(m.status)}</div></div>
      <div class="epoRP-l">Representative</div><div class="epoRP-v">${esc(m.representative)}</div>
    </div></div>`;
  }

  function renderOverviewDetailedDeadlines(m) {
    const buckets = deadlinePresentationBuckets(m.deadlines, !!m.posture?.currentClosed);
    const sameAsNextDeadline = (d) => {
      if (!m.nextDeadline) return false;
      const sameLabel = d.label === m.nextDeadline.label;
      const sameDate = formatDate(d.date) === formatDate(m.nextDeadline.date);
      const sameSource = String(d.sourceDate || '') === String(m.nextDeadline.sourceDate || '');
      return sameLabel && sameDate && sameSource;
    };

    const renderBucket = (title, deadlines, bucketKind) => {
      if (!deadlines.length) return '';
      let rows = '';
      for (const d of deadlines) {
        const ds = formatDate(d.date);
        const dd = Math.ceil((d.date.getTime() - Date.now()) / 86400000);
        const proximity = bucketKind === 'historical'
          ? 'info'
          : bucketKind === 'monitoring'
            ? (dd < 0 ? 'info' : dd <= 45 ? 'warn' : 'info')
            : (dd < 0 ? 'bad' : dd <= 14 ? 'bad' : dd <= 45 ? 'warn' : 'ok');
        const badgeText = bucketKind === 'historical'
          ? `${ds} · historical`
          : `${ds}${Number.isFinite(dd) ? ` · ${dd >= 0 ? formatDaysHuman(dd) : `${formatDaysHuman(dd).slice(1)} overdue`}` : ''}`;
        const metaParts = [
          bucketKind === 'monitoring' ? 'third-party monitoring window' : '',
          bucketKind === 'historical' ? (d.superseded ? 'superseded context' : d.resolved ? 'responded / historical context' : 'historical context') : '',
          `From ${d.sourceDate || 'procedural event'}`,
          d.confidence ? `${d.confidence} confidence` : '',
          d.method || '',
          d.rolledOver ? `rolled over${d.rolloverNote ? ` (${d.rolloverNote})` : ''}` : '',
          d.supersededBy?.dateStr ? `later EPO outcome on ${d.supersededBy.dateStr}` : '',
          d.resolved && bucketKind !== 'historical' ? 'responded' : '',
        ].filter(Boolean);
        rows += `<div class="epoRP-dr"><div class="epoRP-dn">${esc(d.label)}</div><div class="epoRP-dd"><span class="epoRP-bdg ${esc(proximity)}">${esc(badgeText)}</span><div class="epoRP-m">${esc(`(${metaParts.join(' · ')})`)}</div></div></div>`;
      }
      return `<div class="epoRP-m">${esc(title)}</div><div class="epoRP-dl">${rows}</div>`;
    };

    const activeDeadlines = buckets.active.filter((d) => !sameAsNextDeadline(d));
    const sections = [
      renderBucket('Active clocks', activeDeadlines, 'active'),
      renderBucket('Monitoring windows', buckets.monitoring, 'monitoring'),
      renderBucket('Historical / superseded clocks', buckets.historical, 'historical'),
    ].filter(Boolean);

    return sections.length
      ? `<div class="epoRP-m">Detailed clocks</div>${sections.join('')}<div class="epoRP-m">Procedural due dates are heuristic unless the Register provides explicit legal due dates.</div>`
      : '';
  }

  function overviewNextDeadlineState(m) {
    const nextDeadlineBadge = m.daysToDeadline != null
      ? `<span class="epoRP-bdg ${m.daysToDeadline < 0 ? 'bad' : m.daysToDeadline <= 14 ? 'bad' : m.daysToDeadline <= 45 ? 'warn' : 'ok'}">${m.daysToDeadline >= 0 ? formatDaysHuman(m.daysToDeadline) : `${formatDaysHuman(m.daysToDeadline).slice(1)} overdue`}</span>`
      : '';

    let nextDeadlineMethod = normalize(m.nextDeadline?.method || '').replace(/\s*\n\s*/g, ' ');
    const nextDeadlineSourceDate = normalize(m.nextDeadline?.sourceDate || '');
    const sourceAlreadyInMethod = nextDeadlineSourceDate
      && new RegExp(`from\\s+communication\\s+date\\s+${nextDeadlineSourceDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(nextDeadlineMethod);
    if (sourceAlreadyInMethod && nextDeadlineSourceDate) {
      nextDeadlineMethod = normalize(nextDeadlineMethod.replace(new RegExp(`\\s*from\\s+communication\\s+date\\s+${nextDeadlineSourceDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ''));
    }

    const nextDeadlineMetaLines = [];
    const nextDeadlineContextBits = [];
    if (nextDeadlineSourceDate && !sourceAlreadyInMethod) nextDeadlineContextBits.push(`From ${nextDeadlineSourceDate}`);
    if (m.nextDeadline?.confidence) nextDeadlineContextBits.push(`${m.nextDeadline.confidence} confidence`);
    if (nextDeadlineContextBits.length) nextDeadlineMetaLines.push(nextDeadlineContextBits.join(' · '));
    if (nextDeadlineMethod) nextDeadlineMetaLines.push(`Basis: ${nextDeadlineMethod}`);
    if (m.nextDeadline?.rolledOver) nextDeadlineMetaLines.push(`Calendar rollover${m.nextDeadline.rolloverNote ? ` (${m.nextDeadline.rolloverNote})` : ''}`);
    if (m.nextDeadline?.resolved) nextDeadlineMetaLines.push('Marked as responded');

    const nextDeadlineMetaHtml = nextDeadlineMetaLines.map((line) => `<div class="epoRP-m">${esc(line)}</div>`).join('');
    return { nextDeadlineBadge, nextDeadlineMetaHtml };
  }

  function renderOverviewActionableCard(m) {
    const detailedDeadlinesHtml = renderOverviewDetailedDeadlines(m);
    const { nextDeadlineBadge, nextDeadlineMetaHtml } = overviewNextDeadlineState(m);
    const latestEpoText = overviewLatestActionText(m.latestEpo);
    const latestApplicantText = overviewLatestActionText(m.latestApplicant);
    const waitingLevel = m.waitingDays == null ? 'info' : (m.waitingDays > 365 ? 'bad' : m.waitingDays > 180 ? 'warn' : 'ok');
    const waitingSummary = m.waitingOn === 'EPO'
      ? `EPO${m.waitingDays != null ? ` · <span class="epoRP-bdg ${waitingLevel}">${formatDaysHuman(m.waitingDays)} since applicant response</span>` : ''}`
      : m.waitingOn === 'EPO recovery outcome'
        ? `EPO recovery outcome${m.waitingDays != null ? ` · <span class="epoRP-bdg ${waitingLevel}">${formatDaysHuman(m.waitingDays)} since applicant reply</span>` : ''}`
        : 'No active step';
    const postureBadge = `<span class="epoRP-bdg ${esc(m.posture?.level || m.statusLevel || 'info')}">${esc(m.posture?.label || m.statusSimple || 'Unknown')}</span>`;

    const recoveryHtml = m.recoveryAction
      ? `<div class="epoRP-l">${esc(m.recoveryAction.label || 'Recovery')}</div><div class="epoRP-v"><div><span class="epoRP-bdg ${esc(m.recoveryAction.level || 'info')}">${esc(m.recoveryAction.badge || 'Recovery')}</span></div>${m.recoveryAction.summary ? `<div class="epoRP-m">${esc(m.recoveryAction.summary)}</div>` : ''}${m.recoveryAction.note ? `<div class="epoRP-m">${esc(m.recoveryAction.note)}</div>` : ''}</div>`
      : '';

    return `<div class="epoRP-c"><h4>Actionable status</h4><div class="epoRP-g">
      <div class="epoRP-l">Current posture</div><div class="epoRP-v">${postureBadge}${m.posture?.note ? `<div class="epoRP-m">${esc(m.posture.note)}</div>` : ''}</div>
      <div class="epoRP-l">Next deadline</div><div class="epoRP-v">${m.nextDeadline ? `<div>${esc(formatDate(m.nextDeadline.date))} · ${esc(m.nextDeadline.label)}${nextDeadlineBadge ? ` · ${nextDeadlineBadge}` : ''}</div>${nextDeadlineMetaHtml}` : (m.nextDeadlineNote ? `<div>—</div><div class="epoRP-m">${esc(m.nextDeadlineNote)}</div>` : '—')}</div>
      <div class="epoRP-l">Latest actions</div><div class="epoRP-v"><div>EPO: ${esc(latestEpoText)}</div><div>Applicant: ${esc(latestApplicantText)}</div></div>
      ${recoveryHtml}
      <div class="epoRP-l">Waiting on</div><div class="epoRP-v">${waitingSummary}</div>
    </div>${detailedDeadlinesHtml}</div>`;
  }

  function renderOverviewRenewalsCard(m) {
    const filingDateObj = parseDateString(m.filingDate);
    const yearsFromFiling = filingDateObj ? Math.max(0, Math.floor((Date.now() - filingDateObj.getTime()) / (365.25 * 86400000))) : null;
    const patentYearFromFiling = yearsFromFiling != null ? yearsFromFiling + 1 : null;
    const nextDueDays = m.renewal.nextDue ? Math.ceil((m.renewal.nextDue.getTime() - Date.now()) / 86400000) : null;
    const terminalPosture = /closed|withdrawn|refused|revoked/i.test(`${m.stage || ''} ${m.status || ''} ${m.federated?.status || ''}`);
    const dueLevel = terminalPosture
      ? 'info'
      : (nextDueDays == null ? 'info' : (nextDueDays < 0 ? 'bad' : nextDueDays <= 30 ? 'bad' : nextDueDays <= 75 ? 'warn' : 'ok'));
    const dueText = m.renewal.nextDue
      ? `${esc(formatDate(m.renewal.nextDue))}${terminalPosture ? ' · historical central-fee date' : (nextDueDays != null ? ` · ${nextDueDays >= 0 ? formatDaysHuman(nextDueDays) : `${formatDaysHuman(nextDueDays).slice(1)} overdue`}` : '')}`
      : 'Not available';
    const graceText = m.renewal.graceUntil
      ? `${terminalPosture ? 'Historical grace until' : 'Grace until'} ${esc(formatDate(m.renewal.graceUntil))}${m.renewal.dueState === 'grace' && !terminalPosture ? ' (surcharge period active)' : ''}`
      : '';
    const federatedPaidYear = Number(String(m.federated?.renewalFeesPaidUntil || '').match(/Year\s+(\d+)/i)?.[1] || 0) || null;
    const effectivePaidYear = Math.max(Number(m.renewal.highestYear || 0) || 0, Number(federatedPaidYear || 0) || 0) || null;
    const patentYearStatus = effectivePaidYear
      ? `Paid through Year ${effectivePaidYear}${patentYearFromFiling ? ` · current year ${patentYearFromFiling}` : ''}`
      : (patentYearFromFiling ? `Current year ${patentYearFromFiling}` : 'No renewal payment captured yet');
    const latestRenewalNote = m.renewal.latest
      ? `Last payment ${m.renewal.latest.dateStr}${m.renewal.latest.year ? ` · Year ${m.renewal.latest.year}` : ''}`
      : (federatedPaidYear ? `Federated register reports payments through Year ${federatedPaidYear}` : 'No renewal payment event cached.');
    const confidenceBadge = `<span class="epoRP-bdg info">${esc(`${m.renewal.confidence || 'low'} confidence`)}</span>`;
    const postureNote = terminalPosture ? 'Shown as historical fee context because the case appears closed/withdrawn.' : '';

    return `<div class="epoRP-c"><h4>Renewals</h4><div class="epoRP-g">
      <div class="epoRP-l">Status</div><div class="epoRP-v">${esc(patentYearStatus)}<div class="epoRP-m">${esc(latestRenewalNote)}</div></div>
      <div class="epoRP-l">Forum</div><div class="epoRP-v">${esc(m.renewal.feeForum || 'Unknown')}</div>
      <div class="epoRP-l">${terminalPosture ? 'Central-fee schedule' : 'Next fee'}</div><div class="epoRP-v">${m.renewal.nextYear ? `Year ${m.renewal.nextYear} · ` : ''}${m.renewal.nextDue ? `<span class="epoRP-bdg ${dueLevel}">${dueText}</span>` : dueText}${graceText ? `<div class="epoRP-m">${graceText}</div>` : ''}</div>
      ${m.renewal.mentionGrantDate ? `<div class="epoRP-l">Grant mention</div><div class="epoRP-v">${esc(m.renewal.mentionGrantDate)}</div>` : ''}
    </div><div class="epoRP-m">${esc(m.renewal.explanatoryBasis)}</div><div class="epoRP-m">${confidenceBadge}${postureNote ? ` <span>${esc(postureNote)}</span>` : ''}</div></div>`;
  }

  function citationCategoryLevel(categories = []) {
    const joined = categories.join(' ');
    if (/\bX/.test(joined)) return 'bad';
    if (/\bY/.test(joined)) return 'warn';
    return 'info';
  }

  function renderOverviewCitationsCard(m) {
    const phases = m.citations.phases || [];
    if (!phases.length) return '';

    let html = `<div class="epoRP-c"><h4>Citations</h4>`;
    html += `<div class="epoRP-m">${esc(`${m.citations.entries.length} citation${m.citations.entries.length === 1 ? '' : 's'} across ${phases.length} phase${phases.length === 1 ? '' : 's'}`)}</div>`;
    for (const phase of phases.slice(0, 3)) {
      html += `<div class="epoRP-m"><b>${esc(phase.name)}</b></div>`;
      html += `<div class="epoRP-pubs">`;
      for (const entry of phase.entries.slice(0, 3)) {
        const catText = entry.categories?.length ? entry.categories.join('/') : 'ref';
        html += `<div class="epoRP-pub"><div><div class="epoRP-pn">${esc(entry.publicationNo)}</div><div class="epoRP-pm">${esc(entry.applicant || entry.type || phase.name)}</div></div><div class="epoRP-d"><span class="epoRP-bdg ${citationCategoryLevel(entry.categories || [])}">${esc(catText)}</span></div></div>`;
      }
      html += `</div>`;
    }
    if (phases.length > 3) html += `<div class="epoRP-m">${esc(`+ ${phases.length - 3} more citation phase${phases.length - 3 === 1 ? '' : 's'}`)}</div>`;
    html += `</div>`;
    return html;
  }

  function renderOverviewUpcUeCard(m) {
    const upStates = normalize(m.federated?.upMemberStates || '');
    const upCount = upStates ? upStates.split(/,\s*/).filter(Boolean).length : 0;
    const trackedStates = Number(m.federated?.trackedStates || 0) || 0;
    const notableStates = Array.isArray(m.federated?.notableStates) ? m.federated.notableStates : [];
    const noteParts = [];
    if (m.upcUe.note) noteParts.push(m.upcUe.note);
    if (/Unitary effect registered/i.test(m.upcUe.unitaryEffect)) noteParts.push('Opt-out is generally not relevant once unitary effect is registered.');
    if (trackedStates) noteParts.push(`Federated register tracks ${trackedStates} national/UP record${trackedStates === 1 ? '' : 's'}${m.federated?.recordUpdated ? ` (updated ${m.federated.recordUpdated})` : ''}.`);
    if (notableStates.length) noteParts.push(`Notable states: ${notableStates.map((s) => `${s.state}${s.notInForceSince ? ` (not in force since ${s.notInForceSince})` : ''}`).join(', ')}`);

    return `<div class="epoRP-c"><h4>UPC / UE</h4><div class="epoRP-g">
      <div class="epoRP-l">Unitary effect record</div><div class="epoRP-v">${esc(m.upcUe.unitaryEffect)}</div>
      <div class="epoRP-l">UPC registry</div><div class="epoRP-v">${esc(m.upcUe.upcRegistryStatus)}</div>
      <div class="epoRP-l">UP coverage</div><div class="epoRP-v">${upStates ? `${esc(upStates)} <span class="epoRP-bdg ok">${upCount} states</span>` : '—'}</div>
      <div class="epoRP-l">Federated status</div><div class="epoRP-v">${esc(m.federated?.status || '—')}</div>
      <div class="epoRP-l">Renewals paid to</div><div class="epoRP-v">${esc(m.federated?.renewalFeesPaidUntil || '—')}</div>
      <div class="epoRP-l">Invalidation</div><div class="epoRP-v">${esc(m.federated?.invalidationDate || '—')}</div>
    </div><div class="epoRP-m">${esc(noteParts.filter(Boolean).join(' '))}</div></div>`;
  }

  function renderOverviewPublicationsCard(caseNo, m) {
    let html = `<div class="epoRP-c"><h4>Publications (${m.publications.length})</h4>`;
    if (m.publications.length) {
      html += `<div class="epoRP-pubs">`;
      for (const p of m.publications.slice(0, 24)) {
        const number = `${p.no}${p.kind || ''}`;
        html += `<div class="epoRP-pub"><div><div class="epoRP-pn"><a class="epoRP-a" href="${esc(sourceUrl(caseNo, 'main'))}">${esc(number)}</a></div><div class="epoRP-pm">${esc(p.role || 'Publication')}</div></div><div class="epoRP-d">${esc(p.dateStr)}</div></div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="epoRP-m">No publication entries yet. Family/main source may still be loading.</div>`;
    }
    html += `</div>`;
    return html;
  }

  function renderOverview(caseNo) {
    const opts = options();
    const m = overviewModel(caseNo);

    let html = renderOverviewHeaderCard(m);
    html += renderOverviewActionableCard(m);
    if (opts.showRenewals) html += renderOverviewRenewalsCard(m);
    if (opts.showUpcUe) html += renderOverviewUpcUeCard(m);
    html += renderOverviewPublicationsCard(caseNo, m);
    if (opts.showCitations) html += renderOverviewCitationsCard(m);
    return html;
  }

  function timelineItemHtml(item, compact = false, inGroup = false) {
    const actorClass = item.actor === 'Applicant' ? 'actor-applicant' : item.actor === 'EPO' ? 'actor-epo' : item.actor === 'Third party' ? 'actor-third' : '';
    const classes = ['epoRP-it'];
    if (compact) classes.push('compact');
    if (inGroup) classes.push('in-group');
    return `<div class="${classes.join(' ')}">
      <div class="epoRP-dot ${esc(item.level || 'info')} ${esc(actorClass)}"></div>
      <div class="epoRP-d">${esc(item.dateStr || '—')}</div>
      <div>
        <div class="epoRP-mn">${item.url ? `<a class="epoRP-a" href="${esc(item.url)}">${esc(item.title)}</a>` : esc(item.title)}</div>
        <div class="epoRP-sb">${esc(timelineSubtitleText(item))}</div>
      </div>
    </div>`;
  }

  function renderTimeline(caseNo) {
    const opts = options();
    const items = timelineModel(caseNo);
    if (!items.length) return `<div class="epoRP-c"><div class="epoRP-m">No timeline items yet. Background loading will populate cache incrementally.</div></div>`;

    const compact = opts.timelineDensity === 'compact';
    const verbose = opts.timelineDensity === 'verbose';
    const today = formatDate(new Date());

    let insertedToday = false;
    const out = [];

    for (const item of items) {
      if (!insertedToday) {
        const itemDate = parseDateString(item.dateStr);
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        if (!itemDate || itemDate.getTime() <= midnight.getTime()) {
          out.push(`<div class="epoRP-today"><span>Today · ${esc(today)}</span></div>`);
          insertedToday = true;
        }
      }

      if (item.type === 'group') {
        const actorClass = item.actor === 'Applicant' ? 'actor-applicant' : item.actor === 'EPO' ? 'actor-epo' : item.actor === 'Third party' ? 'actor-third' : '';
        const groupKey = timelineGroupKey(caseNo, item);
        out.push(`<details class="epoRP-grp" data-group-key="${esc(groupKey)}">
          <summary class="epoRP-grph">
            <div class="epoRP-dot ${esc(item.level || 'info')} ${esc(actorClass)}"></div>
            <div class="epoRP-d">${esc(item.dateStr || '—')}</div>
            <div>
              <div class="epoRP-mn">${esc(item.title)} (${(item.items || []).length})</div>
              <div class="epoRP-sb">${esc([item.source || 'Documents', item.actor || 'Mixed'].filter(Boolean).join(' · '))}</div>
            </div>
            <div class="epoRP-garrow">▸</div>
          </summary>
          <div class="epoRP-grpi">${(item.items || []).map((x) => timelineItemHtml(x, compact, true)).join('')}</div>
        </details>`);
      } else {
        out.push(timelineItemHtml(item, compact));
      }
    }

    if (!insertedToday) out.unshift(`<div class="epoRP-today"><span>Today · ${esc(today)}</span></div>`);

    const model = overviewModel(caseNo);
    if (model.nextDeadline) {
      const days = Math.ceil((model.nextDeadline.date.getTime() - Date.now()) / 86400000);
      const level = days < 0 ? 'bad' : days <= 14 ? 'bad' : days <= 45 ? 'warn' : 'ok';
      out.unshift(`<div class="epoRP-deadlineRow"><div class="epoRP-dot dotted ${level}"></div><div class="epoRP-d">${esc(formatDate(model.nextDeadline.date))}</div><div><div class="epoRP-mn">Next deadline</div><div class="epoRP-sb">${esc(model.nextDeadline.label)} · ${days >= 0 ? formatDaysHuman(days) : `${formatDaysHuman(days).slice(1)} overdue`}</div></div></div>`);
    }

    if (model.posture?.label) {
      out.unshift(`<div class="epoRP-deadlineRow"><div class="epoRP-dot dotted ${esc(model.posture.level || 'info')}"></div><div class="epoRP-d">Now</div><div><div class="epoRP-mn">Current posture · ${esc(model.posture.label)}</div><div class="epoRP-sb">${esc(model.posture.note || model.status || '')}</div></div></div>`);
    }

    if (verbose) out.unshift(`<div class="epoRP-m">Verbose mode shows extended source labels, grouped event bodies, and posture explanations.</div>`);

    return `<div class="epoRP-c">${out.join('')}</div>`;
  }

  function renderOptions(caseNo) {
    const o = options();
    const optionSectionsHtml = OPTION_SECTIONS.map((section) => renderOptionSection(section.key, o)).join('');
    const maintenanceSection = `<div class="epoRP-optsec"><div class="epoRP-optsec-h">Maintenance</div><div class="epoRP-optsec-m">Manual refresh and cache controls for this case.</div><div class="epoRP-optsec-b"><div class="epoRP-actions"><button class="epoRP-btn" id="epoRP-reload">Reload all background pages</button><button class="epoRP-btn" id="epoRP-clear">Clear this case cache</button><button class="epoRP-btn" id="epoRP-clear-logs">Clear operation console</button></div></div></div>`;

    return `<div class="epoRP-c"><h4>Options</h4>
      ${optionSectionsHtml}
      ${maintenanceSection}
      <div class="epoRP-console-wrap">
        <div class="epoRP-ol">Current option values</div>
        <div class="epoRP-oh">Effective values for all sidebar parameters.</div>
        <div class="epoRP-optvals" id="epoRP-optvals">${renderOptionSnapshot()}</div>
      </div>
      <div class="epoRP-console-wrap">
        <div class="epoRP-ol">Operation console</div>
        <div class="epoRP-oh">Live sidebar activity for this application (latest entries at top).</div>
        <div class="epoRP-log" id="epoRP-log-console">${renderLogConsole(caseNo)}</div>
      </div>
    </div>`;
  }

  function renderBadges(caseNo) {
    const c = getCase(caseNo);
    const counts = sourceStatusCounts(c);
    const mainSource = c.sources.main || {};
    const mainStatus = String(mainSource.status || '').toLowerCase();
    let statusLevel = mainSource.data?.statusLevel || 'info';
    let statusText = mainSource.data?.statusSimple || 'Unknown';

    if (mainStatus === 'notfound') {
      statusLevel = 'bad';
      statusText = 'Not found';
    } else if (mainStatus === 'empty') {
      statusLevel = 'warn';
      statusText = 'No main data';
    }

    const rightTitle = runtime.fetching
      ? `Loading…\n${sourceStatusTooltip(c)}`
      : sourceStatusTooltip(c);
    return {
      left: `<span class="epoRP-bdg ${esc(statusLevel)}">${esc(statusText)}</span>`,
      right: `<span class="epoRP-bdg ${runtime.fetching ? 'info' : sourceStatusLevel(counts)}" title="${esc(rightTitle)}">${runtime.fetching ? esc(runtime.fetchLabel) : esc(sourceStatusSummaryText(counts))}</span>`,
    };
  }

  function applyBodyShift() {
    document.body.classList.toggle('epoRP-shifted', !!options().shiftBody && isCasePage());
  }

  function ensurePanel() {
    let panel = document.getElementById('epoRP-panel');
    if (panel) return panel;

    panel = document.createElement('aside');
    panel.id = 'epoRP-panel';
    panel.className = 'epoRP';
    panel.innerHTML = `<div class="epoRP-hd">
      <div class="epoRP-row"><div><div class="epoRP-t">EP Register Pro <span class="epoRP-ver">v${VERSION}</span></div><div class="epoRP-st" id="epoRP-sub"></div></div><div class="epoRP-acts"><button class="epoRP-btn" id="epoRP-refresh">↻</button><button class="epoRP-btn" id="epoRP-collapse">−</button></div></div>
      <div class="epoRP-badges"><div id="epoRP-badge-left"></div><div id="epoRP-badge-right"></div></div>
      <div class="epoRP-tabs" role="tablist" aria-label="Sidebar views">
        <button class="epoRP-tab" data-view="overview" role="tab" aria-selected="false"><span class="epoRP-tab-ico">▦</span><span>Overview</span></button>
        <button class="epoRP-tab" data-view="timeline" role="tab" aria-selected="false"><span class="epoRP-tab-ico">◷</span><span>Timeline</span></button>
        <button class="epoRP-tab" data-view="options" role="tab" aria-selected="false"><span class="epoRP-tab-ico">⚙</span><span>Options</span></button>
      </div>
    </div><div class="epoRP-body" id="epoRP-body"></div>`;

    document.body.appendChild(panel);

    panel.querySelector('#epoRP-refresh').addEventListener('click', () => prefetchCase(runtime.appNo, true));
    panel.querySelector('#epoRP-collapse').addEventListener('click', () => {
      setUiState({ collapsed: !runtime.collapsed });
      renderPanel();
    });

    panel.querySelectorAll('.epoRP-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        persistCurrentPanelScroll();
        setUiState({ activeView: btn.dataset.view || 'overview' });
        renderPanel();
      });
    });

    runtime.panel = panel;
    runtime.body = panel.querySelector('#epoRP-body');
    runtime.body?.addEventListener('scroll', () => {
      if (runtime.collapsed || !runtime.appNo) return;
      schedulePanelScrollSave(runtime.appNo, runtime.activeView || 'overview', runtime.body.scrollTop || 0);
    }, { passive: true });
    return panel;
  }

  function rerenderPanelPreservingCurrentScroll() {
    const caseNo = runtime.appNo;
    const view = runtime.activeView || 'overview';
    if (!runtime.body || runtime.collapsed || !caseNo) {
      renderPanel();
      return;
    }
    const top = normalizePanelScrollTop(runtime.body.scrollTop || 0);
    setPanelScroll(caseNo, view, top);
    renderPanel();
    restorePanelScroll(caseNo, view, top);
  }

  function commitOptionValue(key, value) {
    const def = OPTION_DEFS_BY_KEY[key] || null;
    const current = options()[key];
    const normalizedValue = def?.kind === 'checkbox' ? !!value : String(value || DEFAULTS[key] || '');
    if (current === normalizedValue) return;
    setOptions({ [key]: normalizedValue });
    if (key === 'doclistGroupsExpandedByDefault') clearDoclistOpenGroups(runtime.appNo || '');
    applyBodyShift();
    rerenderPanelPreservingCurrentScroll();
  }

  function wireOptions() {
    const b = runtime.body;
    if (!b) return;

    for (const def of OPTION_DEFS) {
      const el = b.querySelector(`#${def.id}`);
      if (!el) continue;

      if (def.kind === 'select') {
        el.value = String(options()[def.key] || DEFAULTS[def.key] || '');
        el.addEventListener('change', (event) => {
          commitOptionValue(def.key, event.target.value || DEFAULTS[def.key] || '');
        });
        continue;
      }

      el.checked = !!options()[def.key];
      const commit = () => commitOptionValue(def.key, !!el.checked);
      el.addEventListener('change', commit);
      el.addEventListener('input', commit);
    }

    b.querySelector('#epoRP-reload')?.addEventListener('click', () => {
      addLog(runtime.appNo, 'info', 'Manual reload all background pages');
      rerenderPanelPreservingCurrentScroll();
      prefetchCase(runtime.appNo, true);
    });

    b.querySelector('#epoRP-clear')?.addEventListener('click', () => {
      patchCase(runtime.appNo, (c) => {
        c.sources = {};
      });
      addLog(runtime.appNo, 'warn', 'Manual clear case cache');
      flushNow();
      captureLiveSource(runtime.appNo);
      rerenderPanelPreservingCurrentScroll();
      prefetchCase(runtime.appNo, true);
    });

    b.querySelector('#epoRP-clear-logs')?.addEventListener('click', () => {
      patchCase(runtime.appNo, (c) => {
        c.logs = [];
      });
      flushNow();
      rerenderPanelPreservingCurrentScroll();
    });
  }

  function renderPanel() {
    if (!isCasePage()) {
      runtime.panel?.remove();
      runtime.panel = null;
      runtime.body = null;
      runtime.appNo = '';
      runtime.lastViewLogKey = '';
      clearDerivedCaches();
      document.body.classList.remove('epoRP-shifted');
      return;
    }

    const previousCaseNo = runtime.appNo;
    const previousView = runtime.activeView || 'overview';
    const previousScrollTop = runtime.body && previousCaseNo && !runtime.collapsed
      ? normalizePanelScrollTop(runtime.body.scrollTop || 0)
      : null;
    if (runtime.body && previousCaseNo && !runtime.collapsed) {
      setPanelScroll(previousCaseNo, previousView, previousScrollTop);
    }

    const caseNo = detectAppNo();
    runtime.appNo = caseNo;

    const panel = ensurePanel();
    const o = options();

    applyBodyShift();
    panel.classList.toggle('collapsed', runtime.collapsed);
    panel.style.width = runtime.collapsed ? '200px' : `${o.panelWidthPx}px`;

    panel.querySelector('#epoRP-sub').textContent = `${caseNo} · ${tabSlug()}`;
    panel.querySelector('#epoRP-collapse').textContent = runtime.collapsed ? '+' : '−';

    const badges = renderBadges(caseNo);
    panel.querySelector('#epoRP-badge-left').innerHTML = badges.left;
    panel.querySelector('#epoRP-badge-right').innerHTML = badges.right;

    panel.querySelectorAll('.epoRP-tab').forEach((btn) => {
      const active = btn.dataset.view === runtime.activeView;
      btn.classList.toggle('on', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const body = runtime.body;
    if (!body) return;
    if (runtime.collapsed) {
      body.innerHTML = '';
      return;
    }

    const activeView = runtime.activeView || 'overview';
    const scrollRestoreOverride = panelScrollRestoreOverride(previousCaseNo, previousView, previousScrollTop, caseNo, activeView);
    logViewContext(caseNo, activeView);
    if (activeView === 'timeline') {
      body.innerHTML = renderTimeline(caseNo);
      restorePanelScroll(caseNo, activeView, scrollRestoreOverride);
      return;
    }
    if (activeView === 'options') {
      body.innerHTML = renderOptions(caseNo);
      wireOptions();
      restorePanelScroll(caseNo, activeView, scrollRestoreOverride);
      return;
    }
    body.innerHTML = renderOverview(caseNo);
    restorePanelScroll(caseNo, activeView, scrollRestoreOverride);
  }

  function prepareCaseInit(previousCaseNo, caseNo) {
    const changed = previousCaseNo !== caseNo;
    if (changed) {
      clearDerivedCaches();
      runtime.lastViewLogKey = '';
    }
    runtime.appNo = caseNo;

    if (changed && runtime.fetchCaseNo && runtime.fetchCaseNo !== caseNo) cancelPrefetch();
    return changed;
  }

  function refreshLiveCaseView(caseNo) {
    captureLiveSource(caseNo);
    renderPanel();
    enhanceDoclistGrouping();

    if (initTimer) clearTimeout(initTimer);
    initTimer = setTimeout(() => {
      if (runtime.appNo !== caseNo) return;
      captureLiveSource(caseNo);
      flushNow();
      renderPanel();
      enhanceDoclistGrouping();
    }, 1800);
  }

  function prefetchGateState(caseNo, registerTab, changed) {
    const caseSession = getCaseSession(caseNo);
    if (caseSession.prefetchDoneAt) runtime.autoPrefetchDoneByCase[caseNo] = Number(caseSession.prefetchDoneAt) || Date.now();
    if (caseSession.lastRegisterTab) runtime.lastRegisterTabByCase[caseNo] = String(caseSession.lastRegisterTab);

    const previousRegisterTab = String(runtime.lastRegisterTabByCase[caseNo] || caseSession.lastRegisterTab || '');
    const hasPreviousTab = !!previousRegisterTab;
    const tabChangedWithinCase = hasPreviousTab && previousRegisterTab !== registerTab;
    const sameTabReloadWithinCase = changed && hasPreviousTab && previousRegisterTab === registerTab;
    runtime.lastRegisterTabByCase[caseNo] = registerTab;
    patchCaseSession(caseNo, { lastRegisterTab: registerTab });

    return {
      previousRegisterTab,
      hasPreviousTab,
      tabChangedWithinCase,
      sameTabReloadWithinCase,
    };
  }

  function markPrefetchGate(caseNo, registerTab) {
    const gateTs = Date.now();
    runtime.autoPrefetchDoneByCase[caseNo] = gateTs;
    patchCaseSession(caseNo, { prefetchDoneAt: gateTs, lastRegisterTab: registerTab });
    return gateTs;
  }

  function staleSourceKeys(caseNo, refreshHours = options().refreshHours) {
    return SOURCES
      .filter((s) => !isFresh(getCase(caseNo).sources[s.key], refreshHours, { allowEmpty: true, allowNotFound: true }))
      .map((s) => s.key);
  }

  function logPrefetchGateActive(caseNo, { changed, previousRegisterTab, registerTab, tabChangedWithinCase, sameTabReloadWithinCase }) {
    if (tabChangedWithinCase) {
      addLog(caseNo, 'info', 'Same-case tab switch detected: prefetch gate active', {
        source: 'prefetch',
        fromTab: previousRegisterTab,
        toTab: registerTab,
      });
      return;
    }

    if (sameTabReloadWithinCase) {
      addLog(caseNo, 'info', 'Same-case page reload detected: prefetch gate active', {
        source: 'prefetch',
        registerTab,
      });
      return;
    }

    if (changed) {
      addLog(caseNo, 'info', 'Case tab/page changed; auto prefetch skipped for this page session', {
        source: 'prefetch',
        registerTab,
      });
    }
  }

  function handleForcedCaseReload(caseNo, registerTab) {
    addLog(caseNo, 'info', 'Forced data reload for case', { source: 'prefetch', registerTab });
    markPrefetchGate(caseNo, registerTab);
    prefetchCase(caseNo, true);
  }

  function init(force = false) {
    if (!isCasePage()) {
      cancelPrefetch();
      resetRouteRuntime();
      renderPanel();
      return;
    }

    const previousCaseNo = runtime.appNo;
    const caseNo = detectAppNo();
    const changed = prepareCaseInit(previousCaseNo, caseNo);

    refreshLiveCaseView(caseNo);

    const registerTab = tabSlug();
    const gateState = prefetchGateState(caseNo, registerTab, changed);

    if (force) {
      handleForcedCaseReload(caseNo, registerTab);
      return;
    }

    const staleSources = staleSourceKeys(caseNo);
    const needsRefresh = staleSources.length > 0;

    if (runtime.autoPrefetchDoneByCase[caseNo]) {
      if (needsRefresh) {
        addLog(caseNo, 'warn', 'Prefetch gate bypassed: stale/missing sources detected', {
          source: 'prefetch',
          registerTab,
          staleSources,
        });

        markPrefetchGate(caseNo, registerTab);
        prefetchCase(caseNo, false);
        return;
      }

      logPrefetchGateActive(caseNo, { changed, registerTab, ...gateState });
      return;
    }

    markPrefetchGate(caseNo, registerTab);

    if (needsRefresh) {
      addLog(caseNo, 'info', 'Initial case load: stale/missing sources detected; running auto prefetch', {
        source: 'prefetch',
        registerTab,
        staleSources,
      });
      prefetchCase(caseNo, false);
      return;
    }

    addLog(caseNo, 'ok', 'Initial case load: cache is fresh; no auto prefetch needed', {
      source: 'prefetch',
      registerTab,
    });
  }

  function installRouteObservers() {
    const handleLocationChange = () => {
      if (location.href === runtime.href) return;
      runtime.href = location.href;
      scheduleInit(false);
    };

    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      if (typeof original !== 'function') continue;
      history[method] = function patchedHistoryState(...args) {
        const result = original.apply(this, args);
        handleLocationChange();
        return result;
      };
    }

    addEventListener('popstate', () => {
      runtime.href = location.href;
      scheduleInit(false);
    });

    addEventListener('hashchange', () => {
      runtime.href = location.href;
      scheduleInit(false);
    });

    setInterval(handleLocationChange, 1500);
  }

  GM_addStyle(`
    body.epoRP-shifted{padding-right:${DEFAULTS.pageRightPaddingPx}px !important}
    .epoRP{position:fixed;top:60px;right:10px;z-index:999999;width:${DEFAULTS.panelWidthPx}px;height:calc(100vh - 70px);background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 26px rgba(2,6,23,.18);display:flex;flex-direction:column;color:#0f172a;font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .epoRP.collapsed{height:auto;max-height:55px;overflow:hidden}
    .epoRP-hd{padding:8px 10px;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#f8fafc,#f1f5f9)}
    .epoRP-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .epoRP-t{font-size:14px;font-weight:800}
    .epoRP-ver{font-size:11px;font-weight:700;color:#64748b;margin-left:4px}
    .epoRP-st{font-size:11px;color:#475569}
    .epoRP-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px;padding:4px;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:10px}
    .epoRP-tab{display:flex;align-items:center;justify-content:center;gap:5px;border:1px solid transparent;background:transparent;color:#334155;border-radius:8px;padding:5px 6px;font-size:11px;font-weight:700;cursor:pointer;line-height:1}
    .epoRP-tab:hover{background:#f8fafc;border-color:#cbd5e1}
    .epoRP-tab.on{background:#bfdbfe;color:#0f172a;border-color:#93c5fd;box-shadow:0 1px 0 rgba(15,23,42,.10)}
    .epoRP-tab-ico{font-size:11px;opacity:.9}
    .epoRP-tab.on .epoRP-tab-ico{opacity:1}
    .epoRP-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer}
    .epoRP-acts{display:flex;gap:6px}
    .epoRP-badges{display:flex;justify-content:space-between;gap:6px;margin-top:6px}
    .epoRP-body{padding:8px;overflow:auto;display:flex;flex-direction:column;gap:8px}
    .epoRP-c{border:1px solid #e2e8f0;border-radius:10px;padding:8px;background:#fff}
    .epoRP-g{display:grid;grid-template-columns:115px 1fr;gap:6px;align-items:start}
    .epoRP-l{font-weight:700;color:#334155}
    .epoRP-v{color:#0f172a;white-space:pre-wrap;word-break:break-word}
    .epoRP-m{font-size:11px;color:#64748b;margin-top:6px}
    .epoRP-d{font-variant-numeric:tabular-nums;color:#334155;font-size:11px}
    .epoRP-bdg{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;border:1px solid transparent}
    .epoRP-bdg.info{background:#e2e8f0;border-color:#cbd5e1;color:#334155}
    .epoRP-bdg.ok{background:#dcfce7;border-color:#86efac;color:#14532d}
    .epoRP-bdg.warn{background:#fef3c7;border-color:#fcd34d;color:#854d0e}
    .epoRP-bdg.bad{background:#fee2e2;border-color:#fca5a5;color:#7f1d1d}
    .epoRP-pubs{display:flex;flex-direction:column;gap:6px}
    .epoRP-pub,.epoRP-doc{display:grid;grid-template-columns:1fr auto;gap:8px;padding:6px;border:1px solid #edf2f7;border-radius:8px;background:#fafcff}
    .epoRP-pn{font-weight:700}
    .epoRP-pm{font-size:11px;color:#64748b}
    .epoRP-a{color:#1d4ed8;text-decoration:none}
    .epoRP-a:hover{text-decoration:underline}
    .epoRP-it{display:grid;grid-template-columns:12px 72px 1fr;gap:8px;padding:6px 4px;border-bottom:1px solid #f1f5f9;align-items:center}
    .epoRP-it.compact{padding:4px 2px}
    .epoRP-it:last-child{border-bottom:0}
    .epoRP-it.in-group{background:transparent;border:0;border-radius:0;padding:5px 2px;margin:0}
    .epoRP-it.in-group.compact{padding:3px 2px}
    .epoRP-it.in-group:last-child{border-bottom:0}
    .epoRP-dot{width:9px;height:9px;border-radius:999px;margin-top:0;background:#94a3b8}
    .epoRP-dot.dotted{background:transparent;border:2px dotted #94a3b8;width:10px;height:10px}
    .epoRP-dot.ok{background:#16a34a}
    .epoRP-dot.warn{background:#d97706}
    .epoRP-dot.bad{background:#dc2626}
    .epoRP-dot.info{background:#2563eb}
    .epoRP-dot.actor-epo{background:#2563eb}
    .epoRP-dot.actor-applicant{background:#16a34a}
    .epoRP-dot.actor-third{background:#9333ea}
    .epoRP-dot.dotted.ok{border-color:#16a34a}
    .epoRP-dot.dotted.warn{border-color:#d97706}
    .epoRP-dot.dotted.bad{border-color:#dc2626}
    .epoRP-dot.dotted.info{border-color:#2563eb}
    .epoRP-mn{font-weight:700}
    .epoRP-sb{font-size:11px;color:#64748b;white-space:pre-wrap}
    .epoRP-grp{border:1px solid #e2e8f0;border-radius:10px;padding:0;background:#f8fafc;margin-bottom:7px;overflow:hidden}
    .epoRP-grp[open]{background:#eef6ff;border-color:#bfdbfe;box-shadow:inset 0 0 0 1px #dbeafe}
    .epoRP-grph{display:grid;grid-template-columns:12px 72px 1fr 14px;gap:8px;padding:7px 6px;cursor:pointer;list-style:none;align-items:center;background:transparent;border:0;border-radius:0;appearance:none;-webkit-appearance:none}
    .epoRP-grph .epoRP-mn{font-weight:800}
    .epoRP-grph .epoRP-sb{color:#475569}
    .epoRP-grp[open] .epoRP-grph{background:#e2efff;border-bottom:1px solid #c7dcff}
    .epoRP-grph::marker{content:''}
    .epoRP-grph::-webkit-details-marker{display:none}
    .epoRP-garrow{font-size:16px;font-weight:700;color:#334155;justify-self:end;transition:transform .15s ease}
    .epoRP-grp[open] .epoRP-garrow{transform:rotate(90deg)}
    .epoRP-grp .epoRP-grpi{margin-left:12px;border-left:2px dotted #93c5fd;padding:4px 0 2px 10px;background:transparent}
    .epoRP-grp .epoRP-it.in-group .epoRP-mn{font-weight:600}
    .epoRP-grp .epoRP-it.in-group .epoRP-sb{opacity:.92}
    .epoRP-grp:not([open]) .epoRP-grpi{display:none}
    .epoRP-today{border-top:2px solid #1d4ed8;margin:10px 0 8px;padding-top:4px;font-size:11px;color:#1e40af;font-weight:700}
    .epoRP-dl{display:flex;flex-direction:column;gap:4px}
    .epoRP-dr{display:grid;grid-template-columns:1fr auto;gap:8px;padding:4px 0;border-bottom:1px solid #edf2f7}
    .epoRP-dr:last-child{border-bottom:0}
    .epoRP-dn{font-weight:700}
    .epoRP-dd{font-size:11px}
    .epoRP-optsec{border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:8px 10px;margin-top:8px}
    .epoRP-optsec-h{font-size:12px;font-weight:800;color:#0f172a}
    .epoRP-optsec-m{font-size:10px;color:#64748b;margin-top:2px}
    .epoRP-optsec-b{margin-top:6px}
    .epoRP-or{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #edf2f7}
    .epoRP-or:last-child{border-bottom:0}
    .epoRP-ol{font-weight:700;font-size:11px}
    .epoRP-oh{font-size:10px;color:#64748b}
    .epoRP-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
    .epoRP-console-wrap{margin-top:10px}
    .epoRP-optvals{margin-top:6px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;max-height:220px;overflow:auto}
    .epoRP-optval-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:5px 8px;border-bottom:1px solid #e2e8f0;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .epoRP-optval-row:last-child{border-bottom:0}
    .epoRP-optval-k{color:#1e293b;font-weight:700}
    .epoRP-optval-v{color:#334155;text-align:right;white-space:pre-wrap;word-break:break-word}
    .epoRP-log{margin-top:6px;max-height:230px;overflow:auto;border:1px solid #1e293b;border-radius:8px;background:#0f172a;color:#e2e8f0;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .epoRP-log-row{display:grid;grid-template-columns:58px 48px 1fr;gap:8px;padding:4px 6px;border-bottom:1px solid #1e293b;align-items:start}
    .epoRP-log-row:last-child{border-bottom:0}
    .epoRP-log-ts{color:#94a3b8;font-variant-numeric:tabular-nums}
    .epoRP-log-lv{font-weight:700}
    .epoRP-log-row.ok .epoRP-log-lv{color:#86efac}
    .epoRP-log-row.info .epoRP-log-lv{color:#93c5fd}
    .epoRP-log-row.warn .epoRP-log-lv{color:#fcd34d}
    .epoRP-log-row.bad .epoRP-log-lv,.epoRP-log-row.error .epoRP-log-lv{color:#fca5a5}
    .epoRP-log-msg{white-space:pre-wrap;word-break:break-word}
    .epoRP-log-meta{color:#94a3b8}
    .epoRP-log-empty{padding:8px;color:#94a3b8}
    .epoRP-in{border:1px solid #cbd5e1;border-radius:8px;padding:5px 7px;font-size:12px;width:100%}
    .epoRP-deadlineRow{display:grid;grid-template-columns:12px 72px 1fr;gap:8px;padding:6px 4px;border-bottom:1px dashed #cbd5e1;align-items:start;background:#f8fafc}
    tr.epoRP-docgrp td{background:#eff6ff;color:#1e3a8a;font-weight:700;border-top:2px solid #bfdbfe;border-bottom:1px solid #dbeafe;padding:4px 8px}
    tr.epoRP-docgrp td:first-child{box-shadow:inset 3px 0 0 #3b82f6}
    tr.epoRP-docgrp.open td{background:#dbeafe;border-top-color:#93c5fd;border-bottom-color:#bfdbfe}
    .epoRP-docgrp-head{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center}
    .epoRP-docgrp-sel{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#1e3a8a;white-space:nowrap;cursor:pointer;padding:2px 6px;border:1px solid #bfdbfe;border-radius:999px;background:#ffffff;opacity:.92}
    .epoRP-docgrp-sel input{margin:0}
    .epoRP-docgrp-btn{all:unset;display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;cursor:pointer;font-weight:700;color:#1e3a8a;background:transparent !important;background-image:none !important;border:0 !important;border-radius:0;box-shadow:none !important;padding:0 2px 0 0;appearance:none !important;-webkit-appearance:none !important}
    .epoRP-docgrp-btn::-moz-focus-inner{border:0;padding:0}
    .epoRP-docgrp-btn:focus-visible{outline:2px solid #93c5fd;outline-offset:2px;border-radius:6px}
    .epoRP-docgrp-main{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;min-width:0;flex:1}
    .epoRP-docgrp-label{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .epoRP-docgrp-meta{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#1d4ed8;white-space:nowrap;justify-self:end;padding-right:2px}
    .epoRP-docgrp-sep{opacity:.65}
    .epoRP-docgrp-pages{color:#334155}
    .epoRP-docgrp-arrow{font-size:15px;transition:transform .15s ease;flex:0 0 auto}
    .epoRP-docgrp-btn[aria-expanded="true"] .epoRP-docgrp-arrow{transform:rotate(90deg)}
    tr.epoRP-docgrp-item.epoRP-docgrp-open td{background:#f8fbff}
    tr.epoRP-docgrp-item.epoRP-docgrp-open td:first-child{box-shadow:inset 3px 0 0 #93c5fd}
    tr.epoRP-docgrp-item.epoRP-docgrp-last.epoRP-docgrp-open td{border-bottom:2px solid #bfdbfe}
    tr.epoRP-docgrp-item.collapsed{display:none}
    .epoRP-doclist-filter-wrap{margin:8px 0}
    .epoRP-doclist-filter{width:100%;max-width:420px;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;font:13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .epoRP-filter-hidden{display:none !important}
  `);

  installRouteObservers();

  addEventListener('storage', (event) => {
    if (![CACHE_KEY, OPTIONS_KEY, UI_KEY].includes(event.key)) return;
    if (event.key === CACHE_KEY) {
      memory = null;
      clearDerivedCaches();
    }
    if (event.key === OPTIONS_KEY) {
      optionsShadow = null;
      clearDerivedCaches();
    }
    if (event.key === UI_KEY) {
      const ui = uiState();
      runtime.activeView = ui.activeView || runtime.activeView;
      runtime.collapsed = !!ui.collapsed;
    }
    if (isCasePage()) renderPanel();
  });

  addEventListener('focus', () => {
    if (!isCasePage()) return;
    runtime.href = location.href;
    enhanceDoclistGrouping();
    if (runtime.activeView !== 'timeline') renderPanel();
  });

  document.addEventListener('visibilitychange', () => {
    if (!isCasePage()) return;

    if (document.visibilityState === 'hidden') {
      persistCurrentPanelScroll();
      if (runtime.appNo) persistLiveDoclistGroups(runtime.appNo);
      return;
    }

    if (document.visibilityState !== 'visible') return;
    runtime.href = location.href;
    enhanceDoclistGrouping();
    if (runtime.activeView !== 'timeline') renderPanel();
  });

  addEventListener('pageshow', () => {
    runtime.href = location.href;
    scheduleInit(false);
  });

  addEventListener('beforeunload', () => {
    if (runtime.scrollSaveTimer) {
      clearTimeout(runtime.scrollSaveTimer);
      runtime.scrollSaveTimer = null;
    }
    if (runtime.routeTimer) {
      clearTimeout(runtime.routeTimer);
      runtime.routeTimer = null;
    }
    persistCurrentPanelScroll();
    if (runtime.appNo) persistLiveDoclistGroups(runtime.appNo);
    flushNow();
  });

  init(false);
})();
