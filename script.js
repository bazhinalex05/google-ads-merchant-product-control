/**
 * v1 Unified Merchant Funnel Product Control
 *
 * Один Google Ads Script для трьох задач:
 * 1. Читає товари з Merchant API і будує дерево product_type.
 * 2. Читає статистику товарів з Google Ads і рахує Funnel Builder сегменти.
 * 3. Веде карантин проблемних товарів і формує перший лист Products як допфід.
 *
 * Важливо:
 * - У Google Ads Scripts потрібно увімкнути Advanced APIs:
 *   - Merchant API -> Products
 *   - Merchant API -> Accounts потрібен для першої реєстрації GCP project.
 * - Лист Products має бути першим листом у таблиці. Скрипт переносить його
 *   на першу позицію автоматично.
 * - Products є чистим листом допфіда для Merchant Center.
 *   У ньому мають бути тільки merchant-атрибути: id, excluded_destination,
 *   excluded_destination і вибрана custom_label_N для Funnel Stage.
 * - Службові колонки, статистика, product_type і карантин пишуться в ProductDiagnostics.
 *
 * Telegram: @oleksiibazhyn
 */


/*********************** НАЛАШТУВАННЯ ************************/


// Посилання на Google Sheets таблицю, яку буде оновлювати скрипт.
// Формат: повний URL таблиці, наприклад "https://docs.google.com/spreadsheets/d/.../edit".
var SPREADSHEET_URL = "SPREADSHEET_URL";


// Усі інші налаштування скрипт читає з листа Settings у цій таблиці.
// Якщо листа Settings немає або він порожній, скрипт створить шаблон автоматично.


/**********************************************************
 ПІСЛЯ ЦІЄЇ ЛІНІЇ КОД ЗАЗВИЧАЙ ЗМІНЮВАТИ НЕ ПОТРІБНО
**********************************************************/


var SETTINGS_SHEET_NAME = "Settings";
var DATE_FORMAT = "dd.MM.yyyy";
var API_DATE_FORMAT = "yyyy-MM-dd";
var DEFAULT_SPREADSHEET_LOCALE = "en_US";
var HEADER_BACKGROUND = "#c9daf8";
var SECTION_BACKGROUND = "#e6e6e6";
var MANUAL_BACKGROUND = "#fff2cc";
var REQUIRED_SETTING_BACKGROUND = "#f4cccc";


function main() {
  runUnifiedProductControl();
}


function runUnifiedProductControl() {
  Logger.log("Unified Product Control started.");
  validateBaseSettings_();


  Logger.log("Opening spreadsheet...");
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  Logger.log("Spreadsheet opened.");
  ensureSpreadsheetLocale_(ss);
  var settings = readSettings_(ss);
  Logger.log("Settings loaded. Fast switches: diagnostics=" + settings.enableProductDiagnostics +
    ", dashboardData=" + settings.enableDashboardData +
    ", dashboard=" + settings.enableDashboard +
    ", dashboardFromDiagnostics=" + settings.enableDashboardFromDiagnostics +
    ", formatting=" + settings.enableManagedSheetFormatting +
    ", previousStateRead=" + settings.enablePreviousStateRead +
    ", sheetProtection=" + settings.enableSheetProtection +
    ", productsWrite=" + settings.enableProductsWrite +
    ", writeChunkSize=" + settings.writeChunkSize);
  validateRuntimeSettings_(settings);
  Logger.log("Checking Merchant API services...");
  ensureMerchantApiServicesOn_();
  ensureMerchantApiDeveloperRegistration_(settings);
  Logger.log("Merchant API services ready.");


  Logger.log("Preparing sheets...");
  var sheets = {
    products: getOrCreateSheet_(ss, settings.productsSheetName),
    dashboard: getOrCreateSheet_(ss, settings.dashboardSheetName),
    dashboardData: getOrCreateSheet_(ss, settings.dashboardDataSheetName),
    productTypes: getOrCreateSheet_(ss, settings.productTypesSheetName),
    seasonality: getOrCreateSheet_(ss, settings.seasonalitySheetName),
    productDiagnostics: getOrCreateSheet_(ss, settings.productDiagnosticsSheetName),
    quarantineRegistry: getOrCreateSheet_(ss, settings.quarantineRegistrySheetName),
    quarantineLog: getOrCreateSheet_(ss, settings.quarantineLogSheetName)
  };
  ensureCoreSheetOrder_(ss, sheets.products, sheets.dashboard, sheets.dashboardData);
  Logger.log("Sheets ready.");


  if (settings.enableDashboardFromDiagnostics) {
    Logger.log("Dashboard from ProductDiagnostics mode enabled. Merchant API read skipped.");
    runDashboardFromDiagnostics_(ss, sheets, settings);
    return;
  }


  Logger.log("Reading Merchant API products...");
  var merchantProducts = getMerchantProducts_(settings);
  if (merchantProducts.length === 0) {
    throw new Error("Merchant API повернув 0 товарів після фільтрів. Перевір merchant_id і фільтри на листі Settings.");
  }
  applyExternalProductTypeFeed_(merchantProducts, settings);
  Logger.log("Merchant products ready: " + merchantProducts.length);


  var merchantMap = buildMerchantMap_(merchantProducts);
  var previousProductsMap = {};
  if (settings.enablePreviousStateRead) {
    Logger.log("Reading previous product state...");
    previousProductsMap = readProductsStateMap_(sheets.productDiagnostics, settings.maxLevels);
    if (Object.keys(previousProductsMap).length === 0) {
      previousProductsMap = readProductsStateMap_(sheets.products, settings.maxLevels);
    }
    Logger.log("Previous product state rows: " + Object.keys(previousProductsMap).length);
  } else {
    Logger.log("Попередній стан товарів пропущено через enable_previous_state_read=false.");
  }


  var productTypeRules = { allowedPrefixes: [] };
  var productTypeBenchmarkRules = [];
  var productTypeRows = [];
  var stats30Map = null;
  if (settings.enableProductTypeFilter || settings.enableSeasonalityFilter) {
    Logger.log("ProductType filter or Seasonality enabled. Reading ProductTypes and 30d stats...");
    var manualStateMap = readProductTypeManualStateMap_(sheets.productTypes, settings.maxLevels, settings);
    stats30Map = getAdsStatsMap_(30, 0);
    enrichStatsWithMerchantData_(stats30Map, merchantMap, settings);
    var productTypeStatsMap = buildProductTypeStatsMap_(merchantProducts, stats30Map, settings.maxLevels);
    productTypeRows = buildProductTypeTreeRows_(merchantProducts, manualStateMap, productTypeStatsMap, settings.maxLevels);
    writeProductTypesSheet_(sheets.productTypes, productTypeRows, settings.maxLevels, settings);
    if (settings.enableProductTypeFilter) productTypeRules = buildAllowanceRulesFromRows_(productTypeRows, settings.maxLevels);
    productTypeBenchmarkRules = buildProductTypeBenchmarkRulesFromRows_(productTypeRows, settings.maxLevels);
    Logger.log("ProductType rows ready: " + productTypeRows.length);
  } else {
    Logger.log("Фільтр ProductTypes пропущено через enable_product_type_filter=false.");
  }


  var seasonalityMap = {};
  if (settings.enableSeasonalityFilter) {
    seasonalityMap = readSeasonalityManualStateMap_(sheets.seasonality);
    writeSeasonalitySheet_(sheets.seasonality, merchantProducts, seasonalityMap, settings.maxLevels, settings);
  } else {
    Logger.log("Seasonality пропущено через enable_seasonality_filter=false.");
  }
  var funnelMap = {};
  if (settings.enableFunnelBuilder || settings.enableQuarantine) {
    Logger.log("Reading funnel/quarantine Ads stats...");
    if (stats30Map && Number(settings.funnelDaysAgo) === 30) {
      funnelMap = stats30Map;
    } else {
      funnelMap = getAdsStatsMap_(settings.funnelDaysAgo, 0);
      enrichStatsWithMerchantData_(funnelMap, merchantMap, settings);
    }
    Logger.log("Funnel/quarantine stats ready: " + Object.keys(funnelMap).length);
  } else {
    Logger.log("Статистику воронки і карантину пропущено.");
  }


  var quarantineState = {
    activeById: {},
    registryMap: {}
  };
  if (settings.enableQuarantine) {
    Logger.log("Updating quarantine...");
    quarantineState = updateQuarantine_(sheets.quarantineRegistry, sheets.quarantineLog, merchantMap, settings);
    Logger.log("Quarantine updated. Active: " + Object.keys(quarantineState.activeById || {}).length);
  } else {
    Logger.log("Карантин пропущено через enable_quarantine=false.");
  }


  Logger.log("Building Products rows...");
  var outputRows = buildProductsOutputRows_(
    merchantProducts,
    merchantMap,
    previousProductsMap,
    productTypeRules,
    funnelMap,
    quarantineState.activeById,
    seasonalityMap,
    productTypeBenchmarkRules,
    settings
  );
  Logger.log("Products rows built: " + outputRows.length);


  if (settings.enableProductsWrite) {
    Logger.log("Writing Products sheet...");
    writeProductsSheet_(sheets.products, outputRows, settings);
    Logger.log("Products sheet written.");
  } else {
    Logger.log("Запис листа Products пропущено через enable_products_write=false.");
  }
  if (settings.enableProductDiagnostics) {
    Logger.log("Writing ProductDiagnostics...");
    writeProductDiagnosticsSheet_(sheets.productDiagnostics, outputRows, settings);
    Logger.log("ProductDiagnostics written.");
  } else {
    Logger.log("ProductDiagnostics пропущено через enable_product_diagnostics=false.");
  }
  if (settings.enableDashboardData || settings.enableDashboard) {
    var dashboardStats14Map = getDashboardPeriodStatsMap_(
      14,
      Number(settings.funnelDaysAgo) === 14 ? funnelMap : null,
      merchantMap,
      settings
    );
    var dashboardStats30Map = getDashboardPeriodStatsMap_(
      30,
      stats30Map || (Number(settings.funnelDaysAgo) === 30 ? funnelMap : null),
      merchantMap,
      settings
    );
    if (settings.enableDashboardData) {
      Logger.log("Writing DashboardData...");
      writeDashboardDataSheet_(sheets.dashboardData, outputRows, merchantProducts, dashboardStats14Map, dashboardStats30Map, settings);
      Logger.log("DashboardData written.");
    } else {
      Logger.log("DashboardData пропущено через enable_dashboard_data=false.");
    }
    if (settings.enableDashboard) {
      Logger.log("Ensuring Dashboard...");
      ensureDashboardSheet_(sheets.dashboard, settings);
      Logger.log("Dashboard ready.");
    } else {
      Logger.log("Dashboard пропущено через enable_dashboard=false.");
    }
  } else {
    Logger.log("Статистику Dashboard пропущено, бо enable_dashboard_data=false і enable_dashboard=false.");
  }
  ensureCoreSheetOrder_(ss, sheets.products, sheets.dashboard, sheets.dashboardData);
  hideDefaultBlankSheets_(ss, sheets);
  if (settings.enableSheetProtection) {
    Logger.log("Updating sheet protection...");
    protectManagedSheets_(ss, settings);
    Logger.log("Sheet protection updated.");
  } else {
    Logger.log("Захист листів пропущено через enable_sheet_protection=false.");
  }
  logUnifiedSummary_(merchantProducts, productTypeRows, funnelMap, quarantineState, outputRows, settings);
}


/* ================= Settings ================= */


function validateBaseSettings_() {
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(SPREADSHEET_URL)) {
    throw new Error("Заповни SPREADSHEET_URL посиланням на Google Sheets.");
  }
}


function readSettings_(ss) {
  var defaults = {
    spreadsheetUrl: SPREADSHEET_URL,
    merchantId: "MERCHANT_ID",
    productsSheetName: "Products",
    dashboardSheetName: "Dashboard",
    dashboardDataSheetName: "DashboardData",
    productTypesSheetName: "ProductTypes",
    seasonalitySheetName: "Seasonality",
    productDiagnosticsSheetName: "ProductDiagnostics",
    quarantineRegistrySheetName: "QuarantineRegistry",
    quarantineLogSheetName: "QuarantineLog",
    settingsSheetName: SETTINGS_SHEET_NAME,
    enableProductTypeFilter: true,
    enableFunnelBuilder: true,
    enableQuarantine: true,
    enableProductDiagnostics: true,
    enableDashboardData: true,
    enableDashboard: true,
    enableSeasonalityFilter: false,
    activeSeasonWinter: false,
    activeSeasonSpring: false,
    activeSeasonSummer: false,
    activeSeasonAutumn: false,
    enableProductDiagnostics: true,
    enableDashboardData: true,
    enableDashboard: true,
    enableDashboardFromDiagnostics: false,
    enableManagedSheetFormatting: true,
    enablePreviousStateRead: true,
    enableSheetProtection: true,
    enableProductsWrite: true,
    writeChunkSize: 5000,
    productDiagnosticsStartRow: 1,
    dataSourceFilter: "",
    feedLabelFilter: "",
    languageFilter: "",
    maxLevels: 5,
    enableProductTypeCustomLabelSource: false,
    productTypeCustomLabelField: "custom_label_2",
    productTypeFeedUrl: "",
    productTypeIdPrefixesToStrip: "",
    shoppingExcludedValue: "Shopping_Ads",
    displayExcludedValue: "Display_Ads",
    funnelDaysAgo: 14,
    enableBenchmarkGrouping: true,
    benchmarkLabelField: "custom_label_2",
    funnelStageOutputAttribute: "custom_label_2",
    defaultBenchmarkGroup: "other",
    excludeLastDays: 2,
    problemThreshold: 3,
    enableNoSalesRule: true,
    clicksThreshold: 100,
    noSalesLookbackDays: 30,
    noSalesQuarantineDays: 7,
    enableSpendRule: true,
    spendLookbackDays: 30,
    spendToPriceThreshold: 0.30,
    spendQuarantineDays: 7,
    enableExpensiveClickRule: true,
    expensiveClickLookbackDays: 0,
    expensiveClickThreshold: 100.00,
    expensiveClickQuarantineDays: 7,
    quarantineLogMaxRows: 5000,
    merchantApiPageSize: 1000,
    merchantApiRetryCount: 5,
    merchantApiRetrySleepSeconds: 10,
    includeLegacyLocalProducts: false,
    autoRegisterGcpProject: true,
    developerEmail: "bazhinalex05@gmail.com",
    waitAfterGcpRegistrationSeconds: 300
  };


  var sheet = ss.getSheetByName(defaults.settingsSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(defaults.settingsSheetName);
    writeSettingsTemplate_(sheet, defaults);
    return defaults;
  }


  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    writeSettingsTemplate_(sheet, defaults);
    return defaults;
  }


  var map = {};
  for (var i = 1; i < values.length; i++) {
    var key = safeTrim_(values[i][0]);
    if (!key) continue;
    if (key.substring(0, 2) === "--") continue;
    map[key] = values[i][1];
  }


  defaults.merchantId = readSettingString_(map, "merchant_id", defaults.merchantId);
  defaults.dashboardSheetName = readSettingString_(map, "dashboard_sheet_name", defaults.dashboardSheetName);
  defaults.dashboardDataSheetName = readSettingString_(map, "dashboard_data_sheet_name", defaults.dashboardDataSheetName);
  defaults.enableProductTypeFilter = readSettingBool_(map, "enable_product_type_filter", defaults.enableProductTypeFilter);
  defaults.enableFunnelBuilder = readSettingBool_(map, "enable_funnel_builder", defaults.enableFunnelBuilder);
  defaults.enableQuarantine = readSettingBool_(map, "enable_quarantine", defaults.enableQuarantine);
  defaults.enableProductDiagnostics = readSettingBool_(map, "enable_product_diagnostics", defaults.enableProductDiagnostics);
  defaults.enableDashboardData = readSettingBool_(map, "enable_dashboard_data", defaults.enableDashboardData);
  defaults.enableDashboard = readSettingBool_(map, "enable_dashboard", defaults.enableDashboard);
  defaults.enableSeasonalityFilter = readSettingBool_(map, "enable_seasonality_filter", defaults.enableSeasonalityFilter);
  defaults.activeSeasonWinter = readSettingBool_(map, "active_season_winter", defaults.activeSeasonWinter);
  defaults.activeSeasonSpring = readSettingBool_(map, "active_season_spring", defaults.activeSeasonSpring);
  defaults.activeSeasonSummer = readSettingBool_(map, "active_season_summer", defaults.activeSeasonSummer);
  defaults.activeSeasonAutumn = readSettingBool_(map, "active_season_autumn", defaults.activeSeasonAutumn);
  defaults.enableProductDiagnostics = readSettingBool_(map, "enable_product_diagnostics", defaults.enableProductDiagnostics);
  defaults.enableDashboardData = readSettingBool_(map, "enable_dashboard_data", defaults.enableDashboardData);
  defaults.enableDashboard = readSettingBool_(map, "enable_dashboard", defaults.enableDashboard);
  defaults.enableDashboardFromDiagnostics = readSettingBool_(map, "enable_dashboard_from_diagnostics", defaults.enableDashboardFromDiagnostics);
  defaults.enableManagedSheetFormatting = readSettingBool_(map, "enable_managed_sheet_formatting", defaults.enableManagedSheetFormatting);
  defaults.enablePreviousStateRead = readSettingBool_(map, "enable_previous_state_read", defaults.enablePreviousStateRead);
  defaults.enableSheetProtection = readSettingBool_(map, "enable_sheet_protection", defaults.enableSheetProtection);
  defaults.enableProductsWrite = readSettingBool_(map, "enable_products_write", defaults.enableProductsWrite);
  defaults.writeChunkSize = readSettingInt_(map, "write_chunk_size", defaults.writeChunkSize);
  defaults.productDiagnosticsStartRow = readSettingInt_(map, "product_diagnostics_start_row", defaults.productDiagnosticsStartRow);
  defaults.dataSourceFilter = readSettingString_(map, "data_source_filter", defaults.dataSourceFilter);
  defaults.feedLabelFilter = readSettingString_(map, "feed_label_filter", defaults.feedLabelFilter);
  defaults.languageFilter = readSettingString_(map, "language_filter", defaults.languageFilter);
  defaults.maxLevels = readSettingInt_(map, "max_product_type_levels", defaults.maxLevels);
  defaults.enableProductTypeCustomLabelSource = readSettingBool_(map, "enable_product_type_custom_label_source", defaults.enableProductTypeCustomLabelSource);
  defaults.productTypeCustomLabelField = readSettingString_(map, "product_type_custom_label_field", defaults.productTypeCustomLabelField);
  defaults.productTypeFeedUrl = readSettingString_(map, "product_type_feed_url", defaults.productTypeFeedUrl);
  defaults.productTypeIdPrefixesToStrip = readSettingString_(map, "product_type_id_prefixes_to_strip", defaults.productTypeIdPrefixesToStrip);
  defaults.shoppingExcludedValue = readSettingString_(map, "shopping_excluded_value", defaults.shoppingExcludedValue);
  defaults.displayExcludedValue = readSettingString_(map, "display_excluded_value", defaults.displayExcludedValue);
  defaults.funnelDaysAgo = readSettingInt_(map, "funnel_days_ago", defaults.funnelDaysAgo);
  defaults.enableBenchmarkGrouping = readSettingBool_(map, "enable_benchmark_grouping", defaults.enableBenchmarkGrouping);
  defaults.benchmarkLabelField = readSettingString_(map, "benchmark_label_field", defaults.benchmarkLabelField);
  defaults.funnelStageOutputAttribute = readSettingString_(map, "funnel_stage_output_attribute", defaults.funnelStageOutputAttribute);
  defaults.defaultBenchmarkGroup = readSettingString_(map, "default_benchmark_group", defaults.defaultBenchmarkGroup);
  defaults.excludeLastDays = readSettingInt_(map, "exclude_last_days", defaults.excludeLastDays);
  defaults.problemThreshold = readSettingInt_(map, "problem_threshold", defaults.problemThreshold);
  defaults.enableNoSalesRule = readSettingBool_(map, "enable_no_sales_rule", defaults.enableNoSalesRule);
  defaults.clicksThreshold = readSettingNumber_(map, "clicks_threshold", defaults.clicksThreshold);
  defaults.noSalesLookbackDays = readSettingInt_(map, "no_sales_lookback_days", defaults.noSalesLookbackDays);
  defaults.noSalesQuarantineDays = readSettingInt_(map, "no_sales_quarantine_days", defaults.noSalesQuarantineDays);
  defaults.enableSpendRule = readSettingBool_(map, "enable_spend_rule", defaults.enableSpendRule);
  defaults.spendLookbackDays = readSettingInt_(map, "spend_lookback_days", defaults.spendLookbackDays);
  defaults.spendToPriceThreshold = readSettingNumber_(map, "spend_to_price_threshold", defaults.spendToPriceThreshold);
  defaults.spendQuarantineDays = readSettingInt_(map, "spend_quarantine_days", defaults.spendQuarantineDays);
  defaults.enableExpensiveClickRule = readSettingBool_(map, "enable_expensive_click_rule", defaults.enableExpensiveClickRule);
  defaults.expensiveClickLookbackDays = readSettingInt_(map, "expensive_click_lookback_days", defaults.expensiveClickLookbackDays);
  defaults.expensiveClickThreshold = readSettingNumber_(map, "expensive_click_threshold", defaults.expensiveClickThreshold);
  defaults.expensiveClickQuarantineDays = readSettingInt_(map, "expensive_click_quarantine_days", defaults.expensiveClickQuarantineDays);
  defaults.quarantineLogMaxRows = readSettingInt_(map, "quarantine_log_max_rows", defaults.quarantineLogMaxRows);
  defaults.merchantApiPageSize = readSettingInt_(map, "merchant_api_page_size", defaults.merchantApiPageSize);
  defaults.merchantApiRetryCount = readSettingInt_(map, "merchant_api_retry_count", defaults.merchantApiRetryCount);
  defaults.merchantApiRetrySleepSeconds = readSettingInt_(map, "merchant_api_retry_sleep_seconds", defaults.merchantApiRetrySleepSeconds);
  defaults.includeLegacyLocalProducts = readSettingBool_(map, "include_legacy_local_products", defaults.includeLegacyLocalProducts);
  defaults.autoRegisterGcpProject = readSettingBool_(map, "auto_register_gcp_project", defaults.autoRegisterGcpProject);
  defaults.developerEmail = readSettingString_(map, "developer_email", defaults.developerEmail);
  defaults.waitAfterGcpRegistrationSeconds = readSettingNumber_(map, "wait_after_gcp_registration_seconds", defaults.waitAfterGcpRegistrationSeconds);
  writeSettingsTemplate_(sheet, defaults);


  return defaults;
}


function writeSettingsTemplate_(sheet, settings) {
  var rows = [
    ["налаштування", "значення", "коментар"],
    ["-- 1. Основні налаштування --", "", ""],
    ["merchant_id", settings.merchantId, "ID Merchant Center. Обов'язково."],
    ["dashboard_sheet_name", settings.dashboardSheetName, "Назва візуального листа Dashboard. Скрипт його не перезаписує."],
    ["dashboard_data_sheet_name", settings.dashboardDataSheetName, "Службовий лист з даними для Dashboard. Скрипт повністю перезаписує тільки його."],
    ["-- 2. Увімкнення функцій --", "", ""],
    ["enable_product_type_filter", settings.enableProductTypeFilter, "true = використовувати галочки ProductTypes; false = не фільтрувати по категоріях."],
    ["enable_seasonality_filter", settings.enableSeasonalityFilter, "true = використовувати сезонність на листі Seasonality."],
    ["enable_funnel_builder", settings.enableFunnelBuilder, "true = рахувати Funnel Builder і писати підсумкову стадію в допфід Products."],
    ["enable_quarantine", settings.enableQuarantine, "true = автоматично виключати проблемні товари через карантин."],
    ["enable_product_diagnostics", settings.enableProductDiagnostics, "false = не записувати ProductDiagnostics для дуже великих каталогів."],
    ["enable_dashboard_data", settings.enableDashboardData, "false = не записувати DashboardData для дуже великих каталогів."],
    ["enable_dashboard", settings.enableDashboard, "false = не будувати Dashboard і графіки для дуже великих каталогів."],
    ["-- 3. Сезонність --", "", ""],
    ["active_season_winter", settings.activeSeasonWinter, "true = зараз активна зима."],
    ["active_season_spring", settings.activeSeasonSpring, "true = зараз активна весна."],
    ["active_season_summer", settings.activeSeasonSummer, "true = зараз активне літо."],
    ["active_season_autumn", settings.activeSeasonAutumn, "true = зараз активна осінь."],
    ["-- 4. Категорії товарів --", "", ""],
    ["max_product_type_levels", settings.maxLevels, "Скільки рівнів product_type писати в окремі колонки."],
    ["enable_product_type_custom_label_source", settings.enableProductTypeCustomLabelSource, "true = брати дерево product_type з custom label, вказаного нижче; якщо там порожньо, буде fallback на штатний product_type."],
    ["product_type_custom_label_field", settings.productTypeCustomLabelField, "custom_label_0..custom_label_4, де лежить повна категорійна цепочка, наприклад Auto > Dodge > Dodge Dart."],
    ["product_type_feed_url", settings.productTypeFeedUrl, "Порожньо = брати product_type з Merchant API. Якщо заповнено, ProductTypes бере категорії тільки з цього XML: g:id + g:product_type. Кілька URL можна писати через кому або з нового рядка."],
    ["product_type_id_prefixes_to_strip", settings.productTypeIdPrefixesToStrip, "Необов'язково. Пишемо тільки префікси ID, які команда додає на початок товарного ID, через кому: 00,01,FX. Для порівняння категорій скрипт зріже ці префікси, але в Products залишить реальні Merchant ID."],
    ["-- 5. Етапи воронки --", "", ""],
    ["funnel_days_ago", settings.funnelDaysAgo, "Період Funnel Builder у днях, включно з сьогодні. 14 = сьогодні + 13 попередніх днів."],
    ["enable_benchmark_grouping", settings.enableBenchmarkGrouping, "true = рахувати пороги окремо по custom label групах."],
    ["benchmark_label_field", settings.benchmarkLabelField, "Звідки читати групу порівняння з Merchant API: custom_label_0..custom_label_4, product_type, product_type_l1..product_type_l5, brand або title. Це джерело, не заголовок допфіда."],
    ["funnel_stage_output_attribute", settings.funnelStageOutputAttribute, "Куди писати Funnel Stage у допфід Products. Формат тільки custom_label_0..custom_label_4, наприклад custom_label_2."],
    ["default_benchmark_group", settings.defaultBenchmarkGroup, "Група для товарів без benchmark label, напр. other. Не трогать."],
    ["-- 6. Карантин --", "", ""],
    ["-- 6.1 Значення для допфіда --", "", ""],
    ["shopping_excluded_value", settings.shoppingExcludedValue, "Значення для першої excluded_destination колонки, яку карантин пише в Products."],
    ["display_excluded_value", settings.displayExcludedValue, "Значення для другої excluded_destination колонки, яку карантин пише в Products."],
    ["-- 6.2 Загальні правила карантину --", "", ""],
    ["exclude_last_days", settings.excludeLastDays, "Скільки останніх днів не враховувати в карантині. 2 = не брати сьогодні і вчора."],
    ["problem_threshold", settings.problemThreshold, "З якого quarantine_count товар вважається проблемним."],
    ["quarantine_log_max_rows", settings.quarantineLogMaxRows, "Скільки останніх подій залишати в QuarantineLog. 0 = не чистити лог."],
    ["-- 6.3 Кліки без продажів --", "", ""],
    ["enable_no_sales_rule", settings.enableNoSalesRule, "true = включити правило 'кліки є, конверсій немає'."],
    ["clicks_threshold", settings.clicksThreshold, "Кліків більше цього значення і 0 конверсій = NO_SALES карантин."],
    ["no_sales_lookback_days", settings.noSalesLookbackDays, "Період перевірки NO_SALES: кліки і конверсії за N днів до exclude_last_days."],
    ["no_sales_quarantine_days", settings.noSalesQuarantineDays, "Тривалість NO_SALES карантину."],
    ["-- 6.4 Перевитрата відносно ціни --", "", ""],
    ["enable_spend_rule", settings.enableSpendRule, "true = перевіряти витрати відносно ціни товару."],
    ["spend_lookback_days", settings.spendLookbackDays, "Період перевірки overspend: витрати за N днів до exclude_last_days."],
    ["spend_to_price_threshold", settings.spendToPriceThreshold, "0.30 = витрати від 30% ціни товару."],
    ["spend_quarantine_days", settings.spendQuarantineDays, "На скільки днів товар піде в карантин через overspend."],
    ["-- 6.5 Дорогий клік --", "", ""],
    ["enable_expensive_click_rule", settings.enableExpensiveClickRule, "true = перевіряти дорогий середній клік."],
    ["expensive_click_lookback_days", settings.expensiveClickLookbackDays, "Період перевірки дорогого CPC. 0 = один останній перевірений день після exclude_last_days."],
    ["expensive_click_threshold", settings.expensiveClickThreshold, "Поріг середнього CPC."],
    ["expensive_click_quarantine_days", settings.expensiveClickQuarantineDays, "На скільки днів товар піде в карантин через дорогий клік."],
    ["-- 7. Фільтри фідів і Merchant API --", "", ""],
    ["data_source_filter", settings.dataSourceFilter, "Порожньо = всі фіди. Вказуй короткий data source ID з URL Merchant Center, наприклад 10332461230. Кілька ID через кому."],
    ["feed_label_filter", settings.feedLabelFilter, "Порожньо = всі feed labels. Кілька значень через кому, наприклад UA,PL."],
    ["language_filter", settings.languageFilter, "Порожньо = всі мови. Кілька значень через кому, наприклад uk,en."],
    ["include_legacy_local_products", settings.includeLegacyLocalProducts, "false = не брати legacy local products; true = брати також локальні товари."],
    ["-- 8. Службові налаштування скрипта --", "", ""],
    ["enable_dashboard_from_diagnostics", settings.enableDashboardFromDiagnostics, "true = будувати Dashboard з готового ProductDiagnostics без читання Merchant API."],
    ["enable_managed_sheet_formatting", settings.enableManagedSheetFormatting, "false = писати тільки значення і не запускати масове форматування службових листів."],
    ["enable_previous_state_read", settings.enablePreviousStateRead, "false = не читати старий стан ProductDiagnostics/Products перед побудовою рядків."],
    ["enable_sheet_protection", settings.enableSheetProtection, "false = не оновлювати захист службових листів."],
    ["enable_products_write", settings.enableProductsWrite, "false = не перезаписувати Products; корисно для окремого запуску діагностики або Dashboard."],
    ["write_chunk_size", settings.writeChunkSize, "Кількість рядків в одному setValues-блоці для великих листів, напр. 3000-10000."],
    ["product_diagnostics_start_row", settings.productDiagnosticsStartRow, "1 = писати ProductDiagnostics з початку. 110001 = дописати хвіст з цього рядка даних."],
    ["auto_register_gcp_project", settings.autoRegisterGcpProject, "Службова опція Merchant API: авто-реєстрація GCP project для Merchant ID. Не трогать."],
    ["developer_email", settings.developerEmail, "Технічний Google Account для Merchant API registration. Після налаштування не трогать."],
    ["wait_after_gcp_registration_seconds", settings.waitAfterGcpRegistrationSeconds, "Пауза після першої реєстрації GCP project, напр. 300 сек. Не трогать."],
    ["merchant_api_page_size", settings.merchantApiPageSize, "Скільки товарів читати за один запит, напр. 1000. Не трогать."],
    ["merchant_api_retry_count", settings.merchantApiRetryCount, "Скільки разів повторювати тимчасові внутрішні помилки Merchant API."],
    ["merchant_api_retry_sleep_seconds", settings.merchantApiRetrySleepSeconds, "Базова пауза між повторними запитами Merchant API. Кожна наступна спроба чекає довше."]
  ];


  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  SpreadsheetApp.flush();
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  SpreadsheetApp.flush();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  formatSettingsTemplate_(sheet, rows);
}












function formatSettingsTemplate_(sheet, rows) {
  var rowCount = rows.length;
  sheet.getRange(1, 1, Math.max(rowCount, sheet.getLastRow(), 1), 3).clearDataValidations();
  sheet.getRange(1, 1, rowCount, 3).setBackground("#ffffff").setFontWeight("normal").setFontColor("#000000");
  sheet.getRange(1, 1, 1, 3).setBackground(HEADER_BACKGROUND).setFontWeight("bold");


  for (var i = 1; i < rowCount; i++) {
    var key = safeTrim_(rows[i][0]);
    if (!key) continue;
    if (key.substring(0, 2) === "--") {
      sheet.getRange(i + 1, 1, 1, 3).setBackground(SECTION_BACKGROUND).setFontWeight("bold");
    } else if (!isSettingsServiceKey_(key)) {
      sheet.getRange(i + 1, 2).setBackground(MANUAL_BACKGROUND);
    }
    if (isRequiredSetupSetting_(key)) {
      sheet.getRange(i + 1, 1).setBackground(REQUIRED_SETTING_BACKGROUND);
    }
  }


  var boolRule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
  var customLabelRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"], true)
    .setAllowInvalid(false)
    .build();
  var benchmarkSourceRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(getBenchmarkLabelFieldOptions_(), true)
    .setAllowInvalid(false)
    .build();


  for (var r = 1; r < rowCount; r++) {
    var settingKey = safeTrim_(rows[r][0]);
    if (!settingKey || settingKey.substring(0, 2) === "--") continue;
    if (typeof rows[r][1] === "boolean") {
      sheet.getRange(r + 1, 2).setDataValidation(boolRule);
    }
    if (settingKey === "product_type_custom_label_field" || settingKey === "funnel_stage_output_attribute") {
      sheet.getRange(r + 1, 2).setDataValidation(customLabelRule);
    } else if (settingKey === "benchmark_label_field") {
      sheet.getRange(r + 1, 2).setDataValidation(benchmarkSourceRule);
    }
  }


  setSettingsColumnWidths_(sheet);
  sheet.setFrozenRows(1);
}


function setSettingsColumnWidths_(sheet) {
  sheet.setColumnWidth(1, 265);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 1295);
  sheet.setColumnWidth(4, 80);
}


function isSettingsServiceKey_(key) {
  return [
    "auto_register_gcp_project",
    "developer_email",
    "wait_after_gcp_registration_seconds",
    "merchant_api_page_size",
    "default_benchmark_group"
  ].indexOf(key) >= 0;
}


function isRequiredSetupSetting_(key) {
  return [
    "merchant_id",
    "product_type_feed_url",
    "benchmark_label_field",
    "funnel_stage_output_attribute"
  ].indexOf(key) >= 0;
}


function getBenchmarkLabelFieldOptions_() {
  return [
    "custom_label_0",
    "custom_label_1",
    "custom_label_2",
    "custom_label_3",
    "custom_label_4",
    "product_type",
    "product_type_l1",
    "product_type_l2",
    "product_type_l3",
    "product_type_l4",
    "product_type_l5",
    "brand",
    "title"
  ];
}


function getLateSettingsRows_(settings) {
  return [
    ["enable_product_type_custom_label_source", settings.enableProductTypeCustomLabelSource, "true = брати дерево product_type з custom label, вказаного нижче; якщо там порожньо, буде fallback на штатний product_type."],
    ["product_type_custom_label_field", settings.productTypeCustomLabelField, "custom_label_0..custom_label_4, де лежить повна категорійна цепочка, наприклад Auto > Dodge > Dodge Dart."],
    ["product_type_feed_url", settings.productTypeFeedUrl, "Порожньо = брати product_type з Merchant API. Якщо заповнено, ProductTypes бере категорії тільки з цього XML: g:id + g:product_type. Кілька URL можна писати через кому або з нового рядка."],
    ["product_type_id_prefixes_to_strip", settings.productTypeIdPrefixesToStrip, "Необов'язково. Пишемо тільки префікси ID, які команда додає на початок товарного ID, через кому: 00,01,FX. Для порівняння категорій скрипт зріже ці префікси, але в Products залишить реальні Merchant ID."]
  ];
}


function appendMissingSettingsRows_(sheet, existingMap, rows) {
  var missing = [];
  for (var i = 0; i < rows.length; i++) {
    if (!existingMap.hasOwnProperty(rows[i][0])) missing.push(rows[i]);
  }
  if (missing.length === 0) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
}


function validateRuntimeSettings_(settings) {
  if (!settings.merchantId || settings.merchantId === "MERCHANT_ID") {
    throw new Error("Заповни merchant_id на листі Settings або MERCHANT_ID у коді.");
  }


  if (settings.maxLevels < 1 || settings.maxLevels > 10) {
    throw new Error("max_product_type_levels має бути від 1 до 10.");
  }


  if (settings.merchantApiPageSize < 1 || settings.merchantApiPageSize > 1000) {
    throw new Error("merchant_api_page_size має бути від 1 до 1000.");
  }


  if (settings.merchantApiRetryCount < 0 || settings.merchantApiRetryCount > 10) {
    throw new Error("merchant_api_retry_count має бути від 0 до 10.");
  }


  if (settings.merchantApiRetrySleepSeconds < 1 || settings.merchantApiRetrySleepSeconds > 120) {
    throw new Error("merchant_api_retry_sleep_seconds має бути від 1 до 120.");
  }


  if (settings.writeChunkSize < 100 || settings.writeChunkSize > 20000) {
    throw new Error("write_chunk_size має бути від 100 до 20000.");
  }


  if (settings.productDiagnosticsStartRow < 1) {
    throw new Error("product_diagnostics_start_row має бути 1 або більше.");
  }


  if (settings.funnelDaysAgo < 1) {
    throw new Error("funnel_days_ago must be 1 or more.");
  }


  if (settings.excludeLastDays < 0) {
    throw new Error("exclude_last_days must be 0 or more.");
  }


  if (settings.problemThreshold < 1) {
    throw new Error("problem_threshold must be 1 or more.");
  }


  if (settings.clicksThreshold < 0) {
    throw new Error("clicks_threshold must be 0 or more.");
  }


  if (settings.noSalesLookbackDays < 1) {
    throw new Error("no_sales_lookback_days must be 1 or more.");
  }


  if (settings.noSalesQuarantineDays < 0) {
    throw new Error("no_sales_quarantine_days must be 0 or more.");
  }


  if (settings.spendLookbackDays < 1) {
    throw new Error("spend_lookback_days must be 1 or more.");
  }


  if (settings.spendToPriceThreshold <= 0) {
    throw new Error("spend_to_price_threshold must be greater than 0.");
  }


  if (settings.spendQuarantineDays < 0) {
    throw new Error("spend_quarantine_days must be 0 or more.");
  }


  if (settings.expensiveClickLookbackDays < 0) {
    throw new Error("expensive_click_lookback_days must be 0 or more.");
  }


  if (settings.expensiveClickThreshold <= 0) {
    throw new Error("expensive_click_threshold must be greater than 0.");
  }


  if (settings.expensiveClickQuarantineDays < 0) {
    throw new Error("expensive_click_quarantine_days must be 0 or more.");
  }


  if (settings.quarantineLogMaxRows < 0) {
    throw new Error("quarantine_log_max_rows must be 0 or more.");
  }


  if (settings.waitAfterGcpRegistrationSeconds < 0) {
    throw new Error("wait_after_gcp_registration_seconds must be 0 or more.");
  }


  if (settings.enableProductTypeCustomLabelSource && !toMerchantApiCustomLabelField_(settings.productTypeCustomLabelField)) {
    throw new Error("product_type_custom_label_field має бути custom_label_0..custom_label_4 або customLabel0..customLabel4.");
  }


  var productTypeFeedUrls = parseProductTypeFeedUrls_(settings.productTypeFeedUrl);
  for (var productTypeFeedUrlIndex = 0; productTypeFeedUrlIndex < productTypeFeedUrls.length; productTypeFeedUrlIndex++) {
    if (!/^https?:\/\//i.test(productTypeFeedUrls[productTypeFeedUrlIndex])) {
      throw new Error("product_type_feed_url must contain only HTTP/HTTPS URLs.");
    }
  }


  if (settings.autoRegisterGcpProject && !settings.developerEmail) {
    throw new Error("Заповни developer_email на листі Settings. Він потрібен для першої реєстрації Merchant API GCP project.");
  }


  if (settings.enableBenchmarkGrouping) {
    if (!isAllowedBenchmarkLabelField_(settings.benchmarkLabelField)) {
      throw new Error("benchmark_label_field має бути custom_label_0..custom_label_4, product_type, product_type_l1..product_type_l5, brand або title.");
    }
  }


  if (!isValidFeedCustomLabelHeader_(settings.funnelStageOutputAttribute)) {
    throw new Error("funnel_stage_output_attribute має бути custom_label_0..custom_label_4.");
  }
}


function readSettingString_(map, key, fallback) {
  if (!map.hasOwnProperty(key)) return fallback;
  return safeTrim_(map[key]);
}


function readSettingBool_(map, key, fallback) {
  if (!map.hasOwnProperty(key)) return fallback;
  var value = safeTrim_(map[key]).toLowerCase();
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return fallback;
}


function readSettingInt_(map, key, fallback) {
  if (!map.hasOwnProperty(key)) return fallback;
  var value = parseInt(map[key], 10);
  return isNaN(value) ? fallback : value;
}


function readSettingNumber_(map, key, fallback) {
  if (!map.hasOwnProperty(key)) return fallback;
  var value = Number(String(map[key]).replace(",", "."));
  return isNaN(value) ? fallback : value;
}


/* ================= Merchant API ================= */


function ensureMerchantApiServicesOn_() {
  var accountsService = getMerchantAccountsService_();
  if (!accountsService ||
      !accountsService.Accounts ||
      !accountsService.Accounts.DeveloperRegistration ||
      typeof accountsService.Accounts.DeveloperRegistration.registerGcp !== "function") {
    throw new Error("Увімкни Merchant API -> Accounts в Advanced APIs. Це потрібно один раз, щоб зареєструвати GCP project для нового Merchant API.");
  }


  var service = getMerchantProductsService_();
  if (!service ||
      !service.Accounts ||
      !service.Accounts.Products ||
      typeof service.Accounts.Products.list !== "function") {
    throw new Error("Увімкни Merchant API -> Products в Advanced APIs. Назва сервісу може бути MerchantApiProducts або MerchantProducts.");
  }
}


function getMerchantProductsService_() {
  if (typeof MerchantApiProducts !== "undefined") return MerchantApiProducts;
  if (typeof MerchantProducts !== "undefined") return MerchantProducts;
  return null;
}


function getMerchantAccountsService_() {
  if (typeof MerchantApiAccounts !== "undefined") return MerchantApiAccounts;
  if (typeof MerchantAccounts !== "undefined") return MerchantAccounts;
  return null;
}


function ensureMerchantApiDeveloperRegistration_(settings) {
  if (!settings.autoRegisterGcpProject) return;


  var accountsService = getMerchantAccountsService_();
  var merchantId = String(settings.merchantId);


  try {
    var existing = getMerchantApiDeveloperRegistration_(accountsService, merchantId);
    Logger.log("Merchant API developer registration already exists: " + JSON.stringify(existing));
    return;
  } catch (e) {
    Logger.log("Developer registration is not confirmed or not readable yet: " + String(e));
  }


  try {
    registerMerchantApiDeveloper_(accountsService, merchantId, settings.developerEmail);
    waitAfterMerchantApiRegistration_(settings);
  } catch (e2) {
    var message = String(e2);
    if (message.indexOf("already") !== -1 || message.indexOf("ALREADY_EXISTS") !== -1) {
      Logger.log("GCP project is already registered. Continuing.");
      return;
    }


    var suggestedMerchantId = parseSuggestedRegistrationMerchantId_(message);
    if (suggestedMerchantId && suggestedMerchantId !== merchantId) {
      Logger.log("Merchant API suggested registering the GCP project through parent MC ID: " + suggestedMerchantId);
      try {
        registerMerchantApiDeveloper_(accountsService, suggestedMerchantId, settings.developerEmail);
        waitAfterMerchantApiRegistration_(settings);
        return;
      } catch (e3) {
        message += " | Fallback MC ID " + suggestedMerchantId + " failed: " + String(e3);
      }
    }


    throw new Error("Не вдалося зареєструвати GCP project для Merchant API. Перевір, що користувач скрипта напряму доданий у Merchant Center, сайт Merchant підтверджений, а developer_email є Google Account. Деталі: " + message);
  }
}


function getMerchantApiDeveloperRegistration_(accountsService, merchantId) {
  return accountsService.Accounts.DeveloperRegistration.getDeveloperRegistration(
    "accounts/" + String(merchantId) + "/developerRegistration"
  );
}


function registerMerchantApiDeveloper_(accountsService, merchantId, developerEmail) {
  var name = "accounts/" + String(merchantId) + "/developerRegistration";
  Logger.log("Registering GCP project for Merchant API. Merchant ID: " + merchantId + ". Developer email: " + developerEmail);
  var response = accountsService.Accounts.DeveloperRegistration.registerGcp(
    {
      developerEmail: developerEmail
    },
    name
  );
  Logger.log("GCP project registered for Merchant API: " + JSON.stringify(response));
  return response;
}


function waitAfterMerchantApiRegistration_(settings) {
  if (settings.waitAfterGcpRegistrationSeconds > 0) {
    Logger.log("Waiting " + settings.waitAfterGcpRegistrationSeconds + " seconds for Merchant API registration to propagate...");
    Utilities.sleep(settings.waitAfterGcpRegistrationSeconds * 1000);
  }
}


function parseSuggestedRegistrationMerchantId_(message) {
  var text = safeTrim_(message);
  var marker = "mc id";
  var markerIndex = text.toLowerCase().indexOf(marker);
  if (markerIndex < 0) return "";


  var tail = text.substring(markerIndex + marker.length);
  var id = "";
  for (var i = 0; i < tail.length; i++) {
    var ch = tail.charAt(i);
    if (ch >= "0" && ch <= "9") {
      id += ch;
    } else if (id) {
      break;
    }
  }
  return id;
}


function getMerchantProducts_(settings) {
  var service = getMerchantProductsService_();
  var parent = "accounts/" + String(settings.merchantId);
  var pageToken = null;
  var productsOut = [];
  var stats = {
    pageCount: 0,
    productsRead: 0,
    skippedLegacyLocal: 0,
    skippedDataSource: 0,
    skippedFeedLabel: 0,
    skippedLanguage: 0,
    withoutProductTypes: 0,
    withMultipleProductTypes: 0,
    sampleDataSources: [],
    sampleFeedLabels: [],
    sampleLanguages: []
  };


  do {
    Logger.log("Merchant API page request " + (stats.pageCount + 1) + "...");
    var response = listMerchantProductsPageWithRetry_(service, parent, pageToken, settings, stats.pageCount + 1);
    var products = response && response.products ? response.products : [];
    stats.pageCount++;
    Logger.log("Merchant API page " + stats.pageCount + " received: " + products.length + " products.");


    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      stats.productsRead++;
      addSampleValue_(stats.sampleDataSources, getDataSourceId_(p.dataSource));
      addSampleValue_(stats.sampleFeedLabels, p.feedLabel);
      addSampleValue_(stats.sampleLanguages, p.contentLanguage);


      if (!settings.includeLegacyLocalProducts && p.legacyLocal) {
        stats.skippedLegacyLocal++;
        continue;
      }
      if (!matchesDataSourceFilter_(p.dataSource, settings.dataSourceFilter)) {
        stats.skippedDataSource++;
        continue;
      }
      if (!matchesListFilter_(p.feedLabel, settings.feedLabelFilter)) {
        stats.skippedFeedLabel++;
        continue;
      }
      if (!matchesListFilter_(p.contentLanguage, settings.languageFilter)) {
        stats.skippedLanguage++;
        continue;
      }


      var offerId = safeTrim_(p.offerId);
      if (!offerId) continue;


      var productTypes = getProductTypeStrings_(p, settings);
      if (productTypes.length === 0) stats.withoutProductTypes++;
      if (productTypes.length > 1) stats.withMultipleProductTypes++;


      productsOut.push({
        offerId: offerId,
        normId: normOfferId_(offerId),
        title: safeTrim_(getMerchantProductAttribute_(p, "title")),
        productTypes: productTypes,
        price: getMerchantProductPrice_(p),
        benchmarkGroup: getBenchmarkGroup_(p, settings),
        dataSource: getDataSourceId_(p.dataSource),
        feedLabel: safeTrim_(p.feedLabel),
        contentLanguage: safeTrim_(p.contentLanguage)
      });
    }


    pageToken = response && response.nextPageToken ? response.nextPageToken : null;
    Logger.log("Merchant API progress: read=" + stats.productsRead + ", kept=" + productsOut.length + ", hasNextPage=" + (!!pageToken));
  } while (pageToken);


  Logger.log("Merchant API pages read: " + stats.pageCount);
  Logger.log("Merchant API products read: " + stats.productsRead);
  Logger.log("Merchant API products after filters: " + productsOut.length);
  Logger.log("Пропущено через data_source_filter: " + stats.skippedDataSource);
  Logger.log("Пропущено через feed_label_filter: " + stats.skippedFeedLabel);
  Logger.log("Пропущено через language_filter: " + stats.skippedLanguage);
  Logger.log("Merchant API dataSource ID examples: " + stats.sampleDataSources.join(" | "));
  Logger.log("Merchant API feedLabel examples: " + stats.sampleFeedLabels.join(" | "));
  Logger.log("Merchant API language examples: " + stats.sampleLanguages.join(" | "));
  Logger.log("Products without productTypes: " + stats.withoutProductTypes);
  Logger.log("Products with multiple productTypes: " + stats.withMultipleProductTypes);


  if (stats.productsRead > 0 && productsOut.length === 0) {
    throw new Error(
      "Merchant API returned 0 products after filters. " +
      "data_source_filter uses Merchant Center data source IDs, for example 10332461230. " +
      "dataSource ID examples: " + (stats.sampleDataSources.join(" | ") || "(empty)") + ". " +
      "feedLabel examples: " + (stats.sampleFeedLabels.join(" | ") || "(empty)") + ". " +
      "language examples: " + (stats.sampleLanguages.join(" | ") || "(empty)") + "."
    );
  }


  return productsOut;
}


function listMerchantProductsPageWithRetry_(service, parent, pageToken, settings, pageNumber) {
  var attempts = Math.max(1, Number(settings.merchantApiRetryCount || 0) + 1);
  var baseSleepMs = Math.max(1, Number(settings.merchantApiRetrySleepSeconds || 10)) * 1000;


  for (var attempt = 1; attempt <= attempts; attempt++) {
    try {
      return service.Accounts.Products.list(parent, {
        pageToken: pageToken,
        pageSize: settings.merchantApiPageSize
      });
    } catch (e) {
      var message = String(e);
      if (message.indexOf("not registered with the merchant account") !== -1) {
        throw new Error("Merchant API is not registered for this Merchant ID. Enable auto_register_gcp_project, fill developer_email in Settings, and make sure Merchant API -> Accounts is enabled in Advanced APIs. Details: " + message);
      }


      if (!isRetryableMerchantApiError_(message) || attempt >= attempts) {
        Logger.log("Сторінка Merchant API " + pageNumber + " впала після " + attempt + " спроб(и): " + message);
        throw e;
      }


      var sleepMs = baseSleepMs * attempt;
      Logger.log("Тимчасова помилка Merchant API на сторінці " + pageNumber + ", спроба " + attempt + "/" + attempts + ": " + message);
      Logger.log("Пауза перед повторним запитом Merchant API: " + Math.round(sleepMs / 1000) + " сек.");
      Utilities.sleep(sleepMs);
    }
  }


  throw new Error("Цикл повторних запитів Merchant API неочікувано завершився.");
}


function isRetryableMerchantApiError_(message) {
  var text = safeTrim_(message).toLowerCase();
  return text.indexOf("internal error") !== -1 ||
    text.indexOf("internal error has occurred") !== -1 ||
    text.indexOf("backend error") !== -1 ||
    text.indexOf("rate limit") !== -1 ||
    text.indexOf("quota") !== -1 ||
    text.indexOf("temporarily") !== -1 ||
    text.indexOf("timeout") !== -1 ||
    text.indexOf("unavailable") !== -1 ||
    text.indexOf(" 500") !== -1 ||
    text.indexOf(" 503") !== -1 ||
    text.indexOf(" 429") !== -1;
}


function addSampleValue_(samples, value) {
  if (samples.length >= 10) return;
  var text = safeTrim_(value) || "(empty)";
  if (samples.indexOf(text) === -1) samples.push(text);
}


function buildMerchantMap_(merchantProducts) {
  var map = {};
  for (var i = 0; i < merchantProducts.length; i++) {
    map[merchantProducts[i].normId] = merchantProducts[i];
  }
  return map;
}


function getProductTypeStrings_(product, settings) {
  var result = [];
  var attrs = product.productAttributes || {};


  if (settings && settings.enableProductTypeCustomLabelSource) {
    addProductTypeFromConfiguredCustomLabel_(result, product, settings.productTypeCustomLabelField);
    if (result.length > 0) return result;
  }


  if (attrs.productTypes && attrs.productTypes.length) {
    for (var i = 0; i < attrs.productTypes.length; i++) {
      addUniqueProductType_(result, attrs.productTypes[i]);
    }
  }
  if (attrs.productType) addUniqueProductType_(result, attrs.productType);
  addProductTypesFromCustomAttributes_(result, product.customAttributes);


  return result;
}


function applyExternalProductTypeFeed_(merchantProducts, settings) {
  var urls = parseProductTypeFeedUrls_(settings.productTypeFeedUrl);
  if (urls.length === 0) {
    for (var i = 0; i < merchantProducts.length; i++) {
      merchantProducts[i].categoryMatchId = merchantProducts[i].offerId;
      merchantProducts[i].productTypeSource = "merchant_api";
      merchantProducts[i].productTypeStatus = merchantProducts[i].productTypes.length ? "merchant_api" : "missing_merchant_product_type";
    }
    return;
  }


  var externalMap = buildExternalProductTypeMap_(urls);
  var prefixes = parseIdPrefixes_(settings.productTypeIdPrefixesToStrip);
  var matchedExact = 0;
  var matchedPrefix = 0;
  var missing = 0;


  for (var i = 0; i < merchantProducts.length; i++) {
    var product = merchantProducts[i];
    var match = findExternalProductTypeMatch_(product.offerId, externalMap, prefixes);
    if (match) {
      product.productTypes = [match.productType];
      product.categoryMatchId = match.matchId;
      product.productTypeSource = "external_feed";
      product.productTypeStatus = match.usedPrefix ? "external_feed_prefix" : "external_feed_exact";
      if (match.usedPrefix) matchedPrefix++; else matchedExact++;
    } else {
      product.productTypes = [];
      product.categoryMatchId = product.offerId;
      product.productTypeSource = "external_feed";
      product.productTypeStatus = "missing_external_feed";
      missing++;
    }
  }


  Logger.log("External product_type feed URLs: " + urls.length);
  Logger.log("External product_type IDs loaded: " + Object.keys(externalMap).length);
  Logger.log("External product_type exact matches: " + matchedExact);
  Logger.log("External product_type prefix matches: " + matchedPrefix);
  Logger.log("External product_type missing matches: " + missing);
}


function buildExternalProductTypeMap_(urls) {
  var map = {};
  for (var i = 0; i < urls.length; i++) {
    var xmlText = fetchExternalProductTypeXml_(urls[i]);
    var pairs = collectExternalProductTypePairs_(xmlText);
    Logger.log("External product_type feed #" + (i + 1) + " pairs read: " + pairs.length);
    for (var j = 0; j < pairs.length; j++) {
      var key = normOfferId_(pairs[j].id);
      if (!key || map[key]) continue;
      map[key] = {
        productType: pairs[j].productType,
        sourceIndex: i + 1
      };
    }
  }
  return map;
}


function findExternalProductTypeMatch_(offerId, externalMap, prefixes) {
  var exactKey = normOfferId_(offerId);
  if (externalMap[exactKey]) {
    return {
      matchId: offerId,
      productType: externalMap[exactKey].productType,
      usedPrefix: false
    };
  }


  var raw = safeTrim_(offerId);
  var lower = raw.toLowerCase();
  for (var i = 0; i < prefixes.length; i++) {
    var prefix = prefixes[i];
    if (!prefix) continue;
    if (lower.indexOf(prefix.toLowerCase()) !== 0) continue;
    var stripped = raw.substring(prefix.length);
    var strippedKey = normOfferId_(stripped);
    if (externalMap[strippedKey]) {
      return {
        matchId: stripped,
        productType: externalMap[strippedKey].productType,
        usedPrefix: true
      };
    }
  }


  return null;
}


function fetchExternalProductTypeXml_(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "Accept-Encoding": "gzip"
    }
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Could not fetch product_type_feed_url. HTTP " + code + ". URL: " + url);
  }


  var blob = response.getBlob();
  var bytes = blob.getBytes();
  if (bytes && bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) {
    return Utilities.ungzip(blob).getDataAsString("UTF-8");
  }
  return blob.getDataAsString("UTF-8");
}


function collectExternalProductTypePairs_(xmlText) {
  var result = [];
  var itemRe = /<item\b[\s\S]*?<\/item>/gi;
  var match;
  while ((match = itemRe.exec(xmlText)) !== null) {
    var item = match[0];
    var id = extractXmlTagValue_(item, "g:id") || extractXmlTagValue_(item, "id");
    var productType = extractXmlTagValue_(item, "g:product_type") || extractXmlTagValue_(item, "product_type");
    productType = normalizeProductType_(decodeXmlEntities_(productType));
    if (!id || !productType) continue;
    result.push({
      id: decodeXmlEntities_(id),
      productType: productType
    });
  }
  return result;
}


function extractXmlTagValue_(chunk, tagName) {
  var re = new RegExp("<" + escapeRegex_(tagName) + "\\b[^>]*>([\\s\\S]*?)<\\/" + escapeRegex_(tagName) + ">", "i");
  var match = re.exec(chunk);
  if (!match) return "";
  var value = match[1] || "";
  var cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(value);
  if (cdata) value = cdata[1];
  return safeTrim_(value);
}


function decodeXmlEntities_(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#13;/g, "")
    .replace(/&#10;/g, "")
    .replace(/&#9;/g, "");
}


function escapeRegex_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function parseProductTypeFeedUrls_(value) {
  var raw = safeTrim_(value);
  if (!raw) return [];
  var parts = raw.replace(/\r?\n/g, ",").split(",");
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var url = safeTrim_(parts[i]);
    if (url) result.push(url);
  }
  return result;
}


function parseIdPrefixes_(value) {
  var raw = safeTrim_(value);
  if (!raw) return [];
  var parts = raw.split(",");
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var prefix = safeTrim_(parts[i]);
    if (prefix) result.push(prefix);
  }
  return result;
}


function addProductTypeFromConfiguredCustomLabel_(result, product, customLabelField) {
  var merchantField = toMerchantApiCustomLabelField_(customLabelField);
  if (!merchantField) return;
  addUniqueProductType_(result, getMerchantProductAttribute_(product, merchantField));
}


function addProductTypesFromCustomAttributes_(result, customAttributes) {
  if (!customAttributes || !customAttributes.length) return;
  for (var i = 0; i < customAttributes.length; i++) {
    var attr = customAttributes[i];
    var name = safeTrim_(attr.name).toLowerCase();
    if (name !== "product_type" && name !== "product type" && name !== "producttypes") continue;
    if (attr.value !== null && typeof attr.value !== "undefined") addUniqueProductType_(result, attr.value);
    if (attr.textValue !== null && typeof attr.textValue !== "undefined") addUniqueProductType_(result, attr.textValue);
  }
}


function addUniqueProductType_(result, value) {
  var normalized = normalizeProductType_(value);
  if (!normalized) return;
  for (var i = 0; i < result.length; i++) {
    if (result[i] === normalized) return;
  }
  result.push(normalized);
}


function getBenchmarkGroup_(merchantProduct, settings) {
  if (!settings.enableBenchmarkGrouping) return settings.defaultBenchmarkGroup;


  var value = getBenchmarkLabelFieldValue_(merchantProduct, settings);
  value = safeTrim_(value);
  return value || settings.defaultBenchmarkGroup;
}


function isAllowedBenchmarkLabelField_(fieldName) {
  var normalized = normalizeBenchmarkLabelField_(fieldName);
  var options = getBenchmarkLabelFieldOptions_();
  for (var i = 0; i < options.length; i++) {
    if (normalized === options[i]) return true;
  }
  return false;
}


function normalizeBenchmarkLabelField_(fieldName) {
  var rawValue = safeTrim_(fieldName);
  var customLabel = toMerchantApiCustomLabelField_(rawValue);
  if (customLabel) return merchantApiCustomLabelToFeedHeader_(customLabel);
  return rawValue.toLowerCase();
}


function merchantApiCustomLabelToFeedHeader_(fieldName) {
  var match = safeTrim_(fieldName).match(/^customLabel([0-4])$/);
  return match ? "custom_label_" + match[1] : "";
}


function getBenchmarkLabelFieldValue_(merchantProduct, settings) {
  var fieldName = normalizeBenchmarkLabelField_(settings && settings.benchmarkLabelField);
  var customLabel = toMerchantApiCustomLabelField_(fieldName);
  if (customLabel) return getMerchantProductAttribute_(merchantProduct, customLabel);
  if (fieldName === "product_type") return normalizeProductType_(getPrimaryProductType_(merchantProduct, settings));
  if (fieldName === "brand") return getMerchantProductAttribute_(merchantProduct, "brand");
  if (fieldName === "title") return getMerchantProductAttribute_(merchantProduct, "title");

  var levelMatch = fieldName.match(/^product_type_l([1-5])$/);
  if (levelMatch) {
    var level = Number(levelMatch[1]);
    var path = splitProductType_(getPrimaryProductType_(merchantProduct, settings), level);
    return path[level - 1] || "";
  }
  return "";
}


function getPrimaryProductType_(merchantProduct, settings) {
  var productTypes = getProductTypeStrings_(merchantProduct, settings || {});
  return productTypes.length > 0 ? productTypes[0] : "";
}


function getMerchantProductPrice_(merchantProduct) {
  return parseMerchantPrice_(getMerchantProductAttribute_(merchantProduct, "price"));
}


function getMerchantProductAttribute_(merchantProduct, fieldName) {
  if (merchantProduct.productAttributes &&
      merchantProduct.productAttributes[fieldName] !== null &&
      typeof merchantProduct.productAttributes[fieldName] !== "undefined") {
    return merchantProduct.productAttributes[fieldName];
  }
  if (merchantProduct[fieldName] !== null &&
      typeof merchantProduct[fieldName] !== "undefined") {
    return merchantProduct[fieldName];
  }
  return getCustomAttributeValue_(merchantProduct.customAttributes, fieldName);
}


function getCustomAttributeValue_(customAttributes, fieldName) {
  if (!customAttributes || !customAttributes.length) return null;
  var snakeName = fieldName.replace(/([A-Z])/g, "_$1").toLowerCase();
  for (var i = 0; i < customAttributes.length; i++) {
    var attr = customAttributes[i];
    var name = safeTrim_(attr.name);
    if (name === fieldName || name === snakeName) {
      if (attr.value !== null && typeof attr.value !== "undefined") return attr.value;
      if (attr.textValue !== null && typeof attr.textValue !== "undefined") return attr.textValue;
    }
  }
  return null;
}


function parseMerchantPrice_(price) {
  if (price === null || typeof price === "undefined") return 0;
  if (typeof price === "number") return price;
  if (typeof price === "string") return parseFloat(price.replace(",", ".")) || 0;
  if (typeof price === "object") {
    if (price.amountMicros !== null && typeof price.amountMicros !== "undefined") {
      return Number(price.amountMicros) / 1000000.0;
    }
    if (price.value !== null && typeof price.value !== "undefined") return parseMerchantPrice_(String(price.value));
    if (price.price !== null && typeof price.price !== "undefined") return parseMerchantPrice_(price.price);
  }
  return 0;
}


/* ================= Ads stats and Funnel Builder ================= */


function getAdsStatsMap_(daysAgo, excludeLastDays) {
  var range = getDateRange_(daysAgo, excludeLastDays);
  return getAdsStatsMapForRange_(range.start, range.end);
}


function getAdsStatsMapForRange_(startStr, endStr) {
  var from = yyyymmdd_(startStr);
  var to = yyyymmdd_(endStr);
  var query =
    "SELECT OfferId, Impressions, Clicks, Cost, Conversions, ConversionValue " +
    "FROM SHOPPING_PERFORMANCE_REPORT " +
    "DURING " + from + "," + to;


  Logger.log("AWQL: " + query);


  var map = {};
  var report;
  try {
    report = AdsApp.report(query);
  } catch (e) {
    Logger.log("AWQL failed: " + ((e && e.message) ? e.message : String(e)));
    return map;
  }


  var rows = report.rows();
  var fetched = 0;
  while (rows.hasNext()) {
    var row = rows.next();
    fetched++;


    var rawId = safeTrim_(row["OfferId"]);
    if (!rawId) continue;
    var norm = normOfferId_(rawId);


    if (!map[norm]) {
      map[norm] = {
        offerIdOut: rawId,
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        conversionValue: 0,
        benchmarkGroup: "other"
      };
    }


    map[norm].impressions += toNumber_(row["Impressions"]);
    map[norm].clicks += toNumber_(row["Clicks"]);
    map[norm].cost += toNumber_(row["Cost"]);
    map[norm].conversions += toNumber_(row["Conversions"]);
    map[norm].conversionValue += toNumber_(row["ConversionValue"]);
  }


  Logger.log("AWQL fetched rows: " + fetched + ", unique OfferId: " + Object.keys(map).length);
  return map;
}


function enrichStatsWithMerchantData_(statsMap, merchantMap, settings) {
  var missing = 0;
  for (var normId in statsMap) {
    if (!statsMap.hasOwnProperty(normId)) continue;
    var merchantProduct = merchantMap[normId];
    if (!merchantProduct) {
      missing++;
      statsMap[normId].benchmarkGroup = settings.defaultBenchmarkGroup;
      continue;
    }
    statsMap[normId].offerIdOut = merchantProduct.offerId;
    statsMap[normId].benchmarkGroup = merchantProduct.benchmarkGroup;
  }
  if (missing > 0) {
    Logger.log("Товарів зі статистики Google Ads не знайдено в Merchant: " + missing);
  }
}


function calculateFunnelRows_(statsMap, settings) {
  var noSalesByGroup = {};
  for (var normId in statsMap) {
    if (!statsMap.hasOwnProperty(normId)) continue;
    var product = statsMap[normId];
    if (product.conversions > 0) continue;


    var group = product.benchmarkGroup || settings.defaultBenchmarkGroup;
    if (!noSalesByGroup[group]) noSalesByGroup[group] = [];
    noSalesByGroup[group].push(product);
  }


  var thresholdStatsByGroup = buildThresholdStatsByGroup_(noSalesByGroup);
  var result = {};


  for (var key in statsMap) {
    if (!statsMap.hasOwnProperty(key)) continue;


    var item = statsMap[key];
    var groupName = item.benchmarkGroup || settings.defaultBenchmarkGroup;
    var groupStats = thresholdStatsByGroup[groupName] || {
      clickStats: getDynamicThresholdStats_([], "clicks"),
      impressionStats: getDynamicThresholdStats_([], "impressions")
    };
    var highClicks = isHighMetric_(item.clicks, groupStats.clickStats);
    var highImpressions = isHighMetric_(item.impressions, groupStats.impressionStats);


    result[key] = {
      roas: getRoas_(item),
      salesStatus: item.conversions > 0 ? "продажі" : "без продажів",
      clickSegment: highClicks ? "високі кліки" : "низькі кліки",
      impressionSegment: highImpressions ? "високі покази" : "низькі покази",
      funnelStage: getFunnelStage_(item, highClicks, highImpressions),
      benchmarkGroup: groupName
    };
  }


  logThresholdStatsByGroup_(thresholdStatsByGroup);
  return result;
}


function buildThresholdStatsByGroup_(noSalesByGroup) {
  var result = {};
  for (var groupName in noSalesByGroup) {
    if (!noSalesByGroup.hasOwnProperty(groupName)) continue;
    var products = noSalesByGroup[groupName];
    result[groupName] = {
      clickStats: getDynamicThresholdStats_(products, "clicks"),
      impressionStats: getDynamicThresholdStats_(products, "impressions"),
      productCount: products.length
    };
  }
  return result;
}


function getDynamicThresholdStats_(products, metricName) {
  var positiveValues = [];
  var sumAll = 0;
  var sumPositive = 0;


  for (var i = 0; i < products.length; i++) {
    var value = products[i][metricName] || 0;
    sumAll += value;
    if (value > 0) {
      positiveValues.push(value);
      sumPositive += value;
    }
  }


  var avgAll = products.length > 0 ? sumAll / products.length : 0;
  var avgPositive = positiveValues.length > 0 ? sumPositive / positiveValues.length : 0;
  return {
    avgAll: avgAll,
    avgPositive: avgPositive,
    threshold: Math.ceil((avgAll + avgPositive) / 2),
    hasHighSegment: positiveValues.length > 0 && hasPositiveVariance_(positiveValues)
  };
}


function hasPositiveVariance_(values) {
  if (values.length === 0) return false;
  var first = values[0];
  for (var i = 1; i < values.length; i++) {
    if (values[i] !== first) return true;
  }
  return false;
}


function isHighMetric_(value, stats) {
  if (!stats.hasHighSegment) return false;
  return value > stats.avgAll && value >= stats.threshold;
}


function getRoas_(product) {
  if (product.conversionValue > 0 && product.cost > 0) return product.conversionValue / product.cost;
  if (product.cost === 0 && product.conversionValue > 0) return product.conversionValue;
  return 0;
}


function getFunnelStage_(product, highClicks, highImpressions) {
  if (product.conversions > 0) return "1 продажі";
  if (product.clicks === 0 && product.impressions === 0) return "6 без стат";
  if (highClicks && highImpressions) return "2 вк+вп";
  if (highClicks && !highImpressions) return "3 вк+нп";
  if (!highClicks && highImpressions) return "4 нк+вп";
  return "5 нк+нп";
}


function logThresholdStatsByGroup_(statsByGroup) {
  var groups = Object.keys(statsByGroup);
  Logger.log("Кількість груп для Funnel Builder: " + groups.length);
  for (var i = 0; i < groups.length; i++) {
    var groupName = groups[i];
    var s = statsByGroup[groupName];
    Logger.log(
      "Група: " + groupName +
      "; товарів без продажів: " + s.productCount +
      "; поріг кліків: " + (s.clickStats.hasHighSegment ? s.clickStats.threshold : "вимкнено") +
      "; поріг показів: " + (s.impressionStats.hasHighSegment ? s.impressionStats.threshold : "вимкнено")
    );
  }
}


/* ================= Quarantine ================= */


function updateQuarantine_(registrySheet, logSheet, merchantMap, settings) {
  ensureQuarantineRegistryHeader_(registrySheet);
  ensureQuarantineLogHeader_(logSheet);


  var registryMap = readQuarantineRegistry_(registrySheet);
  var today = getDateOnly_(new Date());
  var todayStr = formatDate_(today);
  applyEnabledQuarantineRules_(registryMap, settings);


  var noSalesStats = settings.enableNoSalesRule ? getAdsStatsMap_(settings.noSalesLookbackDays, settings.excludeLastDays) : {};
  var spendStats = settings.enableSpendRule ? getAdsStatsMap_(settings.spendLookbackDays, settings.excludeLastDays) : {};
  var expensiveClickStats = settings.enableExpensiveClickRule ? getAdsStatsMap_(settings.expensiveClickLookbackDays, settings.excludeLastDays) : {};


  var candidates = {};
  if (settings.enableNoSalesRule) {
    collectNoSalesCandidates_(candidates, noSalesStats, merchantMap, settings, today);
  }
  if (settings.enableSpendRule) {
    collectSpendCandidates_(candidates, spendStats, merchantMap, settings, today);
  }
  if (settings.enableExpensiveClickRule) {
    collectExpensiveClickCandidates_(candidates, expensiveClickStats, merchantMap, settings, today);
  }


  var newLogRows = [];
  var touched = {};


  for (var normId in candidates) {
    if (!candidates.hasOwnProperty(normId)) continue;


    var candidate = candidates[normId];
    var entry = registryMap[normId];
    var wasActive = entry && isDateActive_(entry.activeUntil, today);


    if (!entry) {
      entry = makeEmptyQuarantineEntry_(candidate.offerId);
      registryMap[normId] = entry;
    }


    if (!wasActive) {
      entry.count += 1;
      entry.lastAdded = todayStr;
      newLogRows.push([
        todayStr,
        candidate.offerId,
        candidate.reasons.join(", "),
        candidate.activeUntil,
        candidate.noSalesUntil,
        candidate.spendUntil,
        candidate.expensiveClickUntil
      ]);


      entry.noSales = entry.noSales || candidate.noSales;
      entry.spend = entry.spend || candidate.spend;
      entry.expensiveClick = entry.expensiveClick || candidate.expensiveClick;
      entry.noSalesUntil = maxDateStr_(entry.noSalesUntil, candidate.noSalesUntil);
      entry.spendUntil = maxDateStr_(entry.spendUntil, candidate.spendUntil);
      entry.expensiveClickUntil = maxDateStr_(entry.expensiveClickUntil, candidate.expensiveClickUntil);
      entry.activeUntil = maxDateStr3_(entry.noSalesUntil, entry.spendUntil, entry.expensiveClickUntil);
      entry.problematic = entry.count >= settings.problemThreshold;
    }
    touched[normId] = true;
  }


  writeQuarantineRegistry_(registrySheet, registryMap);
  appendQuarantineLog_(logSheet, newLogRows);
  trimQuarantineLog_(logSheet, settings.quarantineLogMaxRows);


  var activeById = buildActiveQuarantineMap_(registryMap, today);


  Logger.log("Карантин: кандидатів у цьому запуску: " + Object.keys(candidates).length);
  Logger.log("Карантин: нових подій: " + newLogRows.length);
  Logger.log("Карантин: активних товарів: " + Object.keys(activeById).length);


  return {
    registryMap: registryMap,
    activeById: activeById
  };
}


function applyEnabledQuarantineRules_(registryMap, settings) {
  for (var normId in registryMap) {
    if (!registryMap.hasOwnProperty(normId)) continue;
    var entry = registryMap[normId];
    if (!settings.enableNoSalesRule) {
      entry.noSales = false;
      entry.noSalesUntil = "";
    }
    if (!settings.enableSpendRule) {
      entry.spend = false;
      entry.spendUntil = "";
    }
    if (!settings.enableExpensiveClickRule) {
      entry.expensiveClick = false;
      entry.expensiveClickUntil = "";
    }
    entry.activeUntil = maxDateStr3_(entry.noSalesUntil, entry.spendUntil, entry.expensiveClickUntil);
  }
}


function collectNoSalesCandidates_(out, statsMap, merchantMap, settings, today) {
  for (var normId in statsMap) {
    if (!statsMap.hasOwnProperty(normId)) continue;
    var s = statsMap[normId];
    if (s.clicks > settings.clicksThreshold && s.conversions === 0) {
      addQuarantineCandidate_(out, normId, s.offerIdOut, "NO_SALES", addDays_(today, settings.noSalesQuarantineDays));
    }
  }
}


function collectSpendCandidates_(out, statsMap, merchantMap, settings, today) {
  for (var normId in statsMap) {
    if (!statsMap.hasOwnProperty(normId)) continue;
    var merchantProduct = merchantMap[normId];
    if (!merchantProduct || merchantProduct.price <= 0) continue;
    var s = statsMap[normId];
    var spendLimit = merchantProduct.price * settings.spendToPriceThreshold;
    if (s.cost >= spendLimit) {
      Logger.log("SPEND_OVER_MARGIN candidate: id=" + merchantProduct.offerId + ", cost=" + round2_(s.cost) + ", price=" + round2_(merchantProduct.price) + ", threshold=" + settings.spendToPriceThreshold + ", limit=" + round2_(spendLimit));
      addQuarantineCandidate_(out, normId, merchantProduct.offerId, "SPEND_OVER_MARGIN", addDays_(today, settings.spendQuarantineDays));
    }
  }
}


function collectExpensiveClickCandidates_(out, statsMap, merchantMap, settings, today) {
  for (var normId in statsMap) {
    if (!statsMap.hasOwnProperty(normId)) continue;
    var s = statsMap[normId];
    if (s.clicks <= 0) continue;
    var avgCpc = s.cost / s.clicks;
    if (avgCpc >= settings.expensiveClickThreshold) {
      var offerId = merchantMap[normId] ? merchantMap[normId].offerId : s.offerIdOut;
      Logger.log("EXPENSIVE_CLICK candidate: id=" + offerId + ", cost=" + round2_(s.cost) + ", clicks=" + round2_(s.clicks) + ", cpc=" + round2_(avgCpc) + ", threshold=" + settings.expensiveClickThreshold);
      addQuarantineCandidate_(out, normId, offerId, "EXPENSIVE_CLICK", addDays_(today, settings.expensiveClickQuarantineDays));
    }
  }
}


function addQuarantineCandidate_(out, normId, offerId, reason, untilDate) {
  if (!out[normId]) {
    out[normId] = {
      offerId: offerId,
      reasons: [],
      noSales: false,
      spend: false,
      expensiveClick: false,
      noSalesUntil: "",
      spendUntil: "",
      expensiveClickUntil: "",
      activeUntil: ""
    };
  }


  var untilStr = formatDate_(untilDate);
  out[normId].reasons.push(reason);


  if (reason === "NO_SALES") {
    out[normId].noSales = true;
    out[normId].noSalesUntil = untilStr;
  } else if (reason === "SPEND_OVER_MARGIN") {
    out[normId].spend = true;
    out[normId].spendUntil = untilStr;
  } else if (reason === "EXPENSIVE_CLICK") {
    out[normId].expensiveClick = true;
    out[normId].expensiveClickUntil = untilStr;
  }


  out[normId].activeUntil = maxDateStr3_(out[normId].noSalesUntil, out[normId].spendUntil, out[normId].expensiveClickUntil);
}


function ensureQuarantineRegistryHeader_(sheet) {
  var header = [
    "id",
    "quarantine_count",
    "reason_no_sales",
    "reason_spend_over_margin",
    "reason_expensive_click",
    "problematic",
    "active_until",
    "no_sales_until",
    "spend_until",
    "expensive_click_until",
    "last_added"
  ];
  ensureHeaderRow_(sheet, header);
}


function ensureQuarantineLogHeader_(sheet) {
  var header = [
    "date_added",
    "id",
    "reasons",
    "active_until",
    "no_sales_until",
    "spend_until",
    "expensive_click_until"
  ];
  ensureHeaderRow_(sheet, header);
}


function readQuarantineRegistry_(sheet) {
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return map;


  var values = sheet.getRange(2, 1, lastRow - 1, 11).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = safeTrim_(row[0]);
    if (!id) continue;
    map[normOfferId_(id)] = {
      offerId: id,
      count: toNumber_(row[1]),
      noSales: safeTrim_(row[2]) === "YES",
      spend: safeTrim_(row[3]) === "YES",
      expensiveClick: safeTrim_(row[4]) === "YES",
      problematic: safeTrim_(row[5]) === "YES",
      activeUntil: safeTrim_(row[6]),
      noSalesUntil: safeTrim_(row[7]),
      spendUntil: safeTrim_(row[8]),
      expensiveClickUntil: safeTrim_(row[9]),
      lastAdded: safeTrim_(row[10])
    };
  }
  return map;
}


function makeEmptyQuarantineEntry_(offerId) {
  return {
    offerId: offerId,
    count: 0,
    noSales: false,
    spend: false,
    expensiveClick: false,
    problematic: false,
    activeUntil: "",
    noSalesUntil: "",
    spendUntil: "",
    expensiveClickUntil: "",
    lastAdded: ""
  };
}


function writeQuarantineRegistry_(sheet, registryMap) {
  var rows = [];
  var keys = Object.keys(registryMap).sort(naturalCmp_);
  for (var i = 0; i < keys.length; i++) {
    var e = registryMap[keys[i]];
    rows.push([
      e.offerId,
      e.count,
      e.noSales ? "YES" : "",
      e.spend ? "YES" : "",
      e.expensiveClick ? "YES" : "",
      e.problematic ? "YES" : "",
      e.activeUntil,
      e.noSalesUntil,
      e.spendUntil,
      e.expensiveClickUntil,
      e.lastAdded
    ]);
  }


  var headerWidth = 11;
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headerWidth).clearContent();
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headerWidth).setValues(rows);
    sheet.getRange(2, 1, rows.length, 1).setNumberFormat("@");
  }
}


function appendQuarantineLog_(sheet, rows) {
  if (!rows.length) return;
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 7).setValues(rows);
  sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat("@");
}


function trimQuarantineLog_(sheet, maxRows) {
  var keepRows = Math.max(0, Number(maxRows) || 0);
  if (keepRows === 0) return;
  var dataRows = Math.max(0, sheet.getLastRow() - 1);
  var rowsToDelete = dataRows - keepRows;
  if (rowsToDelete > 0) sheet.deleteRows(2, rowsToDelete);
}


function buildActiveQuarantineMap_(registryMap, today) {
  var active = {};
  for (var normId in registryMap) {
    if (!registryMap.hasOwnProperty(normId)) continue;
    var e = registryMap[normId];
    if (isDateActive_(e.activeUntil, today)) {
      active[normId] = {
        activeUntil: e.activeUntil,
        reasons: [
          e.noSales && isDateActive_(e.noSalesUntil, today) ? "NO_SALES" : "",
          e.spend && isDateActive_(e.spendUntil, today) ? "SPEND_OVER_MARGIN" : "",
          e.expensiveClick && isDateActive_(e.expensiveClickUntil, today) ? "EXPENSIVE_CLICK" : ""
        ].filter(function(v) { return v !== ""; }).join(", ")
      };
    }
  }
  return active;
}


/* ================= ProductTypes tree ================= */


function buildProductTypeTreeRows_(products, manualStateMap, statsMap, maxLevels) {
  var root = makeNode_(null);
  var uniquePaths = {};


  for (var i = 0; i < products.length; i++) {
    for (var j = 0; j < products[i].productTypes.length; j++) {
      var path = splitProductType_(products[i].productTypes[j], maxLevels);
      var key = buildPathKey_(path, maxLevels);
      if (!key || uniquePaths[key]) continue;
      uniquePaths[key] = true;
      addPathToTree_(root, path, maxLevels);
    }
  }


  var rows = [];
  dfsEmitTreeRows_(root, 0, createEmptyPath_(maxLevels), rows, manualStateMap, statsMap, maxLevels);
  return rows;
}


function buildProductTypeStatsMap_(products, adsStatsMap, maxLevels) {
  var result = {};


  for (var i = 0; i < products.length; i++) {
    var product = products[i];
    var productType = chooseProductTypeForStats_(product.productTypes);
    if (!productType) continue;
    var path = splitProductType_(productType, maxLevels);
    var depth = getPathDepth_(path, maxLevels);
    if (depth === 0) continue;


    var stats = adsStatsMap[product.normId] || {
      cost: 0,
      conversions: 0,
      conversionValue: 0
    };


    for (var currentDepth = 1; currentDepth <= depth; currentDepth++) {
      var prefix = createEmptyPath_(maxLevels);
      for (var level = 0; level < currentDepth; level++) prefix[level] = path[level];
      var key = buildPathKey_(prefix, maxLevels);
      if (!key) continue;


      var nodeStats = getOrCreateProductTypeStats_(result, key);
      nodeStats.productCount += 1;
      if (product.price > 0) {
        nodeStats.priceCount += 1;
        nodeStats.priceSum += product.price;
      }
      nodeStats.cost += stats.cost || 0;
      if (currentDepth === depth) {
        nodeStats.leafProductCount += 1;
        if (product.price > 0) {
          nodeStats.leafPriceCount += 1;
          nodeStats.leafPriceSum += product.price;
        }
        nodeStats.leafCost += stats.cost || 0;
        nodeStats.leafConversions += stats.conversions || 0;
        nodeStats.leafConversionValue += stats.conversionValue || 0;
      }
    }
  }


  var keys = Object.keys(result);
  for (var k = 0; k < keys.length; k++) {
    var s = result[keys[k]];
    s.rawAov = s.priceCount > 0 ? s.priceSum / s.priceCount : 0;
    s.leafAov = s.leafPriceCount > 0 ? s.leafPriceSum / s.leafPriceCount : 0;
    s.aov = s.rawAov;
    s.conversions = s.leafConversions;
    s.conversionValue = s.leafConversionValue;
    s.cpa = s.leafConversions > 0 ? s.leafCost / s.leafConversions : 0;
  }


  Logger.log("ProductTypes: категорій зі статистикою 30 днів: " + keys.length);
  return result;
}


function chooseProductTypeForStats_(productTypes) {
  if (!productTypes || productTypes.length === 0) return "";
  return productTypes[0];
}


function getOrCreateProductTypeStats_(statsMap, key) {
  if (!statsMap[key]) {
    statsMap[key] = {
      productCount: 0,
      priceCount: 0,
      priceSum: 0,
      rawAov: 0,
      cost: 0,
      leafProductCount: 0,
      leafPriceCount: 0,
      leafPriceSum: 0,
      leafAov: 0,
      leafCost: 0,
      leafConversions: 0,
      leafConversionValue: 0,
      conversions: 0,
      conversionValue: 0,
      cpa: 0,
      aov: 0
    };
  }
  return statsMap[key];
}


function makeNode_(name) {
  return { name: name, children: {} };
}


function addPathToTree_(root, path, maxLevels) {
  var current = root;
  for (var i = 0; i < maxLevels; i++) {
    var label = safeTrim_(path[i]);
    if (!label) break;
    if (!current.children[label]) current.children[label] = makeNode_(label);
    current = current.children[label];
  }
}


function dfsEmitTreeRows_(node, level, currentPath, rows, manualStateMap, statsMap, maxLevels) {
  if (level > 0) {
    currentPath[level - 1] = node.name;
    for (var clearIdx = level; clearIdx < maxLevels; clearIdx++) currentPath[clearIdx] = "";


    var pathKey = buildPathKey_(currentPath, maxLevels);
    var savedState = manualStateMap.hasOwnProperty(pathKey) ? manualStateMap[pathKey] : null;
    var stats = buildProductTypeDisplayStats_(pathKey, node, currentPath, statsMap, maxLevels);
    rows.push({
      checked: savedState ? savedState.checked === true : true,
      winter: savedState ? savedState.winter === true : false,
      spring: savedState ? savedState.spring === true : false,
      summer: savedState ? savedState.summer === true : false,
      autumn: savedState ? savedState.autumn === true : false,
      path: currentPath.slice(),
      aov: stats.aov || 0,
      conversions30d: stats.conversions || 0,
      spend30d: stats.cost || 0,
      cpa30d: stats.cpa || 0,
      conversionValue30d: stats.conversionValue || 0,
      benchmarkLabel: savedState ? (savedState.benchmarkLabel || "") : "",
      targetCpa: savedState ? (savedState.targetCpa || "") : "",
      comment: savedState ? (savedState.comment || "") : ""
    });
  }


  var keys = Object.keys(node.children).sort(naturalCmp_);
  for (var i = 0; i < keys.length; i++) {
    dfsEmitTreeRows_(node.children[keys[i]], level + 1, currentPath.slice(), rows, manualStateMap, statsMap, maxLevels);
  }
}


function buildProductTypeDisplayStats_(pathKey, node, currentPath, statsMap, maxLevels) {
  var stats = statsMap[pathKey] || {};
  var childKeys = Object.keys(node.children);
  if (childKeys.length === 0) return stats;


  var childAovSum = 0;
  var childAovCount = 0;
  for (var i = 0; i < childKeys.length; i++) {
    var childPath = currentPath.slice();
    var childLevel = getPathDepth_(currentPath, maxLevels);
    childPath[childLevel] = childKeys[i];
    for (var clearIdx = childLevel + 1; clearIdx < maxLevels; clearIdx++) childPath[clearIdx] = "";
    var childKey = buildPathKey_(childPath, maxLevels);
    var childStats = buildProductTypeDisplayStats_(childKey, node.children[childKeys[i]], childPath, statsMap, maxLevels);
    if ((childStats.aov || 0) > 0) {
      childAovSum += childStats.aov;
      childAovCount++;
    }
  }


  var ownLeafAov = stats.leafAov || 0;
  if (ownLeafAov > 0) {
    childAovSum += ownLeafAov;
    childAovCount++;
  }


  return {
    aov: childAovCount > 0 ? childAovSum / childAovCount : (stats.aov || 0),
    conversions: stats.leafConversions || 0,
    cost: stats.cost || 0,
    cpa: (stats.leafConversions || 0) > 0 ? (stats.leafCost || 0) / stats.leafConversions : 0,
    conversionValue: stats.leafConversionValue || 0
  };
}


function readProductTypeManualStateMap_(sheet, maxLevels, settings) {
  var result = {};
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < maxLevels + 1) return result;


  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var targetCpaIndex = findHeaderIndex_(header, "target_cpa");
  var commentIndex = findHeaderIndex_(header, "comment");
  var winterIndex = findHeaderIndex_(header, "winter");
  var springIndex = findHeaderIndex_(header, "spring");
  var summerIndex = findHeaderIndex_(header, "summer");
  var autumnIndex = findHeaderIndex_(header, "autumn");
  var benchmarkLabelIndex = findProductTypesBenchmarkLabelIndex_(header, settings);
  if (targetCpaIndex < 0) targetCpaIndex = maxLevels + 1;
  if (commentIndex < 0) commentIndex = maxLevels + 2;


  var width = Math.max(lastCol, commentIndex + 1, targetCpaIndex + 1, benchmarkLabelIndex + 1, maxLevels + 3);
  var data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var currentPath = createEmptyPath_(maxLevels);


  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    applySparsePathRow_(currentPath, row, 1, maxLevels);
    var key = buildPathKey_(currentPath, maxLevels);
    if (!key) continue;
    result[key] = {
      checked: row[0] === true,
      winter: seasonalityCellToBool_(winterIndex >= 0 ? row[winterIndex] : false),
      spring: seasonalityCellToBool_(springIndex >= 0 ? row[springIndex] : false),
      summer: seasonalityCellToBool_(summerIndex >= 0 ? row[summerIndex] : false),
      autumn: seasonalityCellToBool_(autumnIndex >= 0 ? row[autumnIndex] : false),
      benchmarkLabel: benchmarkLabelIndex >= 0 && row[benchmarkLabelIndex] != null ? String(row[benchmarkLabelIndex]) : "",
      targetCpa: row[targetCpaIndex] == null ? "" : String(row[targetCpaIndex]),
      comment: row[commentIndex] == null ? "" : String(row[commentIndex])
    };
  }


  return result;
}


function writeProductTypesSheet_(sheet, rows, maxLevels, settings) {
  var header = buildProductTypesHeader_(sheet, maxLevels, settings);


  var output = [header];
  for (var r = 0; r < rows.length; r++) {
    var displayPath = makeSparseDisplayPath_(rows[r].path, maxLevels);
    var row = [];
    for (var c = 0; c < header.length; c++) {
      row.push(getProductTypesRowValue_(header[c], rows[r], displayPath, maxLevels, r + 2));
    }
    output.push(row);
  }


  clearManagedProductTypesSheet_(sheet, output.length, output[0].length);
  sheet.getRange(1, 1, output.length, output[0].length).setValues(output);
  formatProductTypesSheet_(sheet, output.length, header);
  if (rows.length > 0) {
    var rule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build();
    sheet.getRange(2, 1, rows.length, 1).setDataValidation(rule);
    ["winter", "spring", "summer", "autumn"].forEach(function(name) {
      var col = findHeaderIndex_(header, name) + 1;
      if (col > 0) sheet.getRange(2, col, rows.length, 1).setDataValidation(rule);
    });
  }
}


function buildProductTypesHeader_(sheet, maxLevels, settings) {
  var fixed = ["Вмикаємо"];
  for (var i = 1; i <= maxLevels; i++) fixed.push("product_type_l" + i);
  fixed.push(getProductTypesBenchmarkHeader_(settings), "winter", "spring", "summer", "autumn", "path_key", "path_depth", "has_season_rule");


  var defaultTail = [
    "aov",
    "conversions_30d",
    "spend_30d",
    "actual_cpa_30d",
    "conversion_value_30d",
    "target_cpa",
    "comment"
  ];


  var tail = [];
  if (sheet.getLastRow() >= 1 && sheet.getLastColumn() > fixed.length) {
    var currentHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var c = fixed.length; c < currentHeader.length; c++) {
      var name = safeTrim_(currentHeader[c]);
      if (!name || isProductTypesFixedHeader_(name, maxLevels)) continue;
      if (tail.indexOf(name) < 0) tail.push(name);
    }
  }


  for (var d = 0; d < defaultTail.length; d++) {
    if (tail.indexOf(defaultTail[d]) < 0) tail.push(defaultTail[d]);
  }


  return fixed.concat(tail);
}


function isProductTypesFixedHeader_(name, maxLevels) {
  if (name === "Вмикаємо") return true;
  if (isValidFeedCustomLabelHeader_(name) || name === "benchmark_label" || name === "benchmark_group") return true;
  if (["winter", "spring", "summer", "autumn", "path_key", "path_depth", "has_season_rule"].indexOf(name) >= 0) return true;
  for (var i = 1; i <= maxLevels; i++) {
    if (name === "product_type_l" + i) return true;
  }
  return false;
}


function getProductTypesBenchmarkHeader_(settings) {
  var header = safeTrim_(settings && settings.benchmarkLabelField).toLowerCase();
  return isValidFeedCustomLabelHeader_(header) ? header : "benchmark_label";
}


function findProductTypesBenchmarkLabelIndex_(header, settings) {
  var wanted = getProductTypesBenchmarkHeader_(settings);
  var index = findHeaderIndex_(header, wanted);
  if (index >= 0) return index;
  index = findHeaderIndex_(header, "benchmark_label");
  if (index >= 0) return index;
  index = findHeaderIndex_(header, "benchmark_group");
  if (index >= 0) return index;
  for (var i = 0; i <= 4; i++) {
    index = findHeaderIndex_(header, "custom_label_" + i);
    if (index >= 0) return index;
  }
  return -1;
}


function clearManagedProductTypesSheet_(sheet, rowCount, colCount) {
  var rowsToClear = Math.max(sheet.getLastRow(), rowCount, 1);
  var colsToClear = Math.max(sheet.getLastColumn(), colCount, 1);
  var range = sheet.getRange(1, 1, rowsToClear, colsToClear);
  range.clearContent();
  range.clearDataValidations();
  range.setBackground(null).setFontWeight("normal");
}


function getProductTypesRowValue_(header, rowData, displayPath, maxLevels, rowNumber) {
  if (header === "Вмикаємо") return rowData.checked;
  for (var i = 1; i <= maxLevels; i++) {
    if (header === "product_type_l" + i) return displayPath[i - 1];
  }
  if (isValidFeedCustomLabelHeader_(header) || header === "benchmark_label" || header === "benchmark_group") return rowData.benchmarkLabel || "";
  if (header === "winter") return !!rowData.winter;
  if (header === "spring") return !!rowData.spring;
  if (header === "summer") return !!rowData.summer;
  if (header === "autumn") return !!rowData.autumn;
  if (header === "path_key") return buildPathKey_(rowData.path, maxLevels);
  if (header === "path_depth") return getPathDepth_(rowData.path, maxLevels);
  if (header === "has_season_rule") return "=OR(" + columnLetter_(maxLevels + 3) + rowNumber + ":" + columnLetter_(maxLevels + 6) + rowNumber + ")";
  if (header === "aov") return round2_(rowData.aov);
  if (header === "conversions_30d") return round2_(rowData.conversions30d);
  if (header === "spend_30d") return round2_(rowData.spend30d);
  if (header === "actual_cpa_30d") return round2_(rowData.cpa30d);
  if (header === "conversion_value_30d") return round2_(rowData.conversionValue30d);
  if (header === "target_cpa") return rowData.targetCpa;
  if (header === "comment") return rowData.comment;
  return "";
}


function formatProductTypesSheet_(sheet, rowCount, header) {
  if (rowCount <= 0 || !header || header.length === 0) return;


  var totalCols = header.length;
  var targetCpaCol = findHeaderIndex_(header, "target_cpa") + 1;
  var commentCol = findHeaderIndex_(header, "comment") + 1;
  var benchmarkLabelCol = findProductTypesBenchmarkLabelIndex_(header, null) + 1;
  var firstSeasonCol = findHeaderIndex_(header, "winter") + 1;


  sheet.getRange(1, 1, rowCount, totalCols).setBackground(null).setFontWeight("normal");
  sheet.getRange(1, 1, 1, totalCols).setBackground(HEADER_BACKGROUND).setFontWeight("bold");
  if (rowCount > 1) {
    sheet.getRange(2, 1, rowCount - 1, 1).setBackground(MANUAL_BACKGROUND);
    if (benchmarkLabelCol > 0) sheet.getRange(2, benchmarkLabelCol, rowCount - 1, 1).setBackground(MANUAL_BACKGROUND);
    if (firstSeasonCol > 0) sheet.getRange(2, firstSeasonCol, rowCount - 1, 4).setBackground(MANUAL_BACKGROUND);
    if (targetCpaCol > 0) sheet.getRange(2, targetCpaCol, rowCount - 1, 1).setBackground(MANUAL_BACKGROUND);
    if (commentCol > 0) sheet.getRange(2, commentCol, rowCount - 1, 1).setBackground(MANUAL_BACKGROUND);
  }
  if (benchmarkLabelCol > 0) sheet.showColumns(benchmarkLabelCol, 5);
  ["path_key", "path_depth", "has_season_rule"].forEach(function(name) {
    var col = findHeaderIndex_(header, name) + 1;
    if (col > 0) sheet.hideColumns(col);
  });
  sheet.setFrozenRows(1);
}


function buildAllowanceRulesFromRows_(rows, maxLevels) {
  var prefixes = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].checked === true) prefixes.push(normalizePathToFilledLevels_(rows[i].path, maxLevels));
  }
  return { allowedPrefixes: prefixes };
}


function buildProductTypeBenchmarkRulesFromRows_(rows, maxLevels) {
  var rules = [];
  for (var i = 0; i < rows.length; i++) {
    var label = safeTrim_(rows[i].benchmarkLabel);
    if (!label) continue;
    var path = normalizePathToFilledLevels_(rows[i].path, maxLevels);
    var depth = getPathDepth_(path, maxLevels);
    if (depth === 0) continue;
    rules.push({ path: path, depth: depth, label: label });
  }
  return rules;
}


function chooseProductTypeBenchmarkLabel_(productTypes, rules, maxLevels) {
  if (!productTypes || !rules || rules.length === 0) return "";
  var best = null;
  for (var i = 0; i < productTypes.length; i++) {
    var path = splitProductType_(productTypes[i], maxLevels);
    for (var r = 0; r < rules.length; r++) {
      if (pathStartsWith_(path, rules[r].path, maxLevels) && (!best || rules[r].depth > best.depth)) {
        best = rules[r];
      }
    }
  }
  return best ? best.label : "";
}


function isAnyProductTypeAllowed_(productTypes, rules, maxLevels, enabled) {
  if (!enabled) return true;
  if (!productTypes || productTypes.length === 0) return false;
  for (var i = 0; i < productTypes.length; i++) {
    if (isPathAllowed_(splitProductType_(productTypes[i], maxLevels), rules, maxLevels)) return true;
  }
  return false;
}


function isPathAllowed_(path, rules, maxLevels) {
  for (var i = 0; i < rules.allowedPrefixes.length; i++) {
    if (pathStartsWith_(path, rules.allowedPrefixes[i], maxLevels)) return true;
  }
  return false;
}


function pathStartsWith_(fullPath, prefixPath, maxLevels) {
  for (var i = 0; i < maxLevels; i++) {
    var prefixValue = safeTrim_(prefixPath[i]);
    var fullValue = safeTrim_(fullPath[i]);
    if (!prefixValue) return true;
    if (prefixValue !== fullValue) return false;
  }
  return true;
}


function chooseProductTypeForOutput_(productTypes, rules, maxLevels, enabled) {
  if (!productTypes || productTypes.length === 0) return "";
  if (!enabled) return productTypes[0];
  for (var i = 0; i < productTypes.length; i++) {
    if (isPathAllowed_(splitProductType_(productTypes[i], maxLevels), rules, maxLevels)) return productTypes[i];
  }
  return productTypes[0];
}


/* ================= Seasonality ================= */


function readSeasonalityManualStateMap_(sheet) {
  var result = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;
  var lastCol = Math.max(sheet.getLastColumn(), 21);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idIndex = findHeaderIndex_(header, "id");
  if (idIndex < 0) idIndex = 0;
  var winterIndex = findHeaderIndex_(header, "winter");
  var springIndex = findHeaderIndex_(header, "spring");
  var summerIndex = findHeaderIndex_(header, "summer");
  var autumnIndex = findHeaderIndex_(header, "autumn");
  var manualWinterIndex = findHeaderIndex_(header, "manual_winter");
  var manualSpringIndex = findHeaderIndex_(header, "manual_spring");
  var manualSummerIndex = findHeaderIndex_(header, "manual_summer");
  var manualAutumnIndex = findHeaderIndex_(header, "manual_autumn");
  var commentIndex = findHeaderIndex_(header, "comment");
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var id = safeTrim_(row[idIndex]);
    if (!id) continue;
    var legacyManual = manualWinterIndex < 0 && manualSpringIndex < 0 && manualSummerIndex < 0 && manualAutumnIndex < 0;
    result[normOfferId_(id)] = {
      winter: seasonalityCellToBool_(winterIndex >= 0 ? row[winterIndex] : false),
      spring: seasonalityCellToBool_(springIndex >= 0 ? row[springIndex] : false),
      summer: seasonalityCellToBool_(summerIndex >= 0 ? row[summerIndex] : false),
      autumn: seasonalityCellToBool_(autumnIndex >= 0 ? row[autumnIndex] : false),
      manualWinter: seasonalityCellToBool_((manualWinterIndex >= 0 ? row[manualWinterIndex] : (legacyManual && winterIndex >= 0 ? row[winterIndex] : false))),
      manualSpring: seasonalityCellToBool_((manualSpringIndex >= 0 ? row[manualSpringIndex] : (legacyManual && springIndex >= 0 ? row[springIndex] : false))),
      manualSummer: seasonalityCellToBool_((manualSummerIndex >= 0 ? row[manualSummerIndex] : (legacyManual && summerIndex >= 0 ? row[summerIndex] : false))),
      manualAutumn: seasonalityCellToBool_((manualAutumnIndex >= 0 ? row[manualAutumnIndex] : (legacyManual && autumnIndex >= 0 ? row[autumnIndex] : false))),
      comment: commentIndex >= 0 ? row[commentIndex] : ""
    };
  }
  return result;
}


function writeSeasonalitySheet_(sheet, merchantProducts, manualMap, maxLevels, settings) {
  var header = ["id", "title", "product_type_full_path"];
  for (var i = 1; i <= maxLevels; i++) header.push("product_type_l" + i);
  header.push(
    "manual_winter",
    "manual_spring",
    "manual_summer",
    "manual_autumn",
    "category_winter",
    "category_spring",
    "category_summer",
    "category_autumn",
    "winter",
    "spring",
    "summer",
    "autumn",
    "comment"
  );


  var products = merchantProducts.slice();
  products.sort(function(a, b) {
    return naturalCmp_(a.offerId, b.offerId);
  });


  var output = [header];
  for (var p = 0; p < products.length; p++) {
    var product = products[p];
    var manual = manualMap[product.normId] || {};
    var productType = product.productTypes && product.productTypes.length ? product.productTypes[0] : "";
    var fullPath = normalizeProductType_(productType);
    var path = splitProductType_(fullPath, maxLevels);
    var sheetRow = p + 2;
    var row = [product.offerId, product.title || "", fullPath];
    for (var level = 0; level < maxLevels; level++) row.push(path[level] || "");
    row.push(
      !!manual.manualWinter,
      !!manual.manualSpring,
      !!manual.manualSummer,
      !!manual.manualAutumn,
      buildSeasonalityCategoryFormula_(settings, "winter", sheetRow, maxLevels),
      buildSeasonalityCategoryFormula_(settings, "spring", sheetRow, maxLevels),
      buildSeasonalityCategoryFormula_(settings, "summer", sheetRow, maxLevels),
      buildSeasonalityCategoryFormula_(settings, "autumn", sheetRow, maxLevels)
    );
    var categoryWinterCol = columnLetter_(findHeaderIndex_(header, "category_winter") + 1);
    var categorySpringCol = columnLetter_(findHeaderIndex_(header, "category_spring") + 1);
    var categorySummerCol = columnLetter_(findHeaderIndex_(header, "category_summer") + 1);
    var categoryAutumnCol = columnLetter_(findHeaderIndex_(header, "category_autumn") + 1);
    var manualWinterCol = columnLetter_(findHeaderIndex_(header, "manual_winter") + 1);
    var manualSpringCol = columnLetter_(findHeaderIndex_(header, "manual_spring") + 1);
    var manualSummerCol = columnLetter_(findHeaderIndex_(header, "manual_summer") + 1);
    var manualAutumnCol = columnLetter_(findHeaderIndex_(header, "manual_autumn") + 1);
    row.push(
      "=OR(" + categoryWinterCol + sheetRow + "=TRUE," + manualWinterCol + sheetRow + "=TRUE)",
      "=OR(" + categorySpringCol + sheetRow + "=TRUE," + manualSpringCol + sheetRow + "=TRUE)",
      "=OR(" + categorySummerCol + sheetRow + "=TRUE," + manualSummerCol + sheetRow + "=TRUE)",
      "=OR(" + categoryAutumnCol + sheetRow + "=TRUE," + manualAutumnCol + sheetRow + "=TRUE)",
      manual.comment || ""
    );
    output.push(row);
  }


  sheet.clearContents();


  sheet.getRange(1, 1, output.length, output[0].length).setValues(output);
  formatSeasonalitySheet_(sheet, output.length, header, settings);
  if (products.length > 0) sheet.getRange(2, 1, products.length, 1).setNumberFormat("@");
}


function buildSeasonalityCategoryFormula_(settings, seasonName, rowNumber, maxLevels) {
  var productTypesSheet = quoteSheetNameForFormula_(settings.productTypesSheetName);
  var seasonOffset = { winter: 0, spring: 1, summer: 2, autumn: 3 }[seasonName] || 0;
  var seasonCol = columnLetter_(maxLevels + 3 + seasonOffset);
  var pathKeyCol = columnLetter_(maxLevels + 7);
  var pathDepthCol = columnLetter_(maxLevels + 8);
  var hasRuleCol = columnLetter_(maxLevels + 9);
  var prefixesFormula = buildSeasonalityPathPrefixesFormula_(rowNumber, maxLevels);


  return "=IFERROR(INDEX(SORT(FILTER({" +
    productTypesSheet + "!" + seasonCol + ":" + seasonCol + "," +
    productTypesSheet + "!" + pathDepthCol + ":" + pathDepthCol + "}," +
    productTypesSheet + "!" + hasRuleCol + ":" + hasRuleCol + "=TRUE," +
    "ISNUMBER(MATCH(" + productTypesSheet + "!" + pathKeyCol + ":" + pathKeyCol + ",SPLIT(" + prefixesFormula + ",\"♦\"),0))" +
    "),2,FALSE),1,1),FALSE)";
}


function buildSeasonalityPathPrefixesFormula_(rowNumber, maxLevels) {
  var terms = [];
  for (var depth = 1; depth <= maxLevels; depth++) {
    var parts = [];
    for (var level = 1; level <= depth; level++) {
      parts.push("$" + columnLetter_(3 + level) + rowNumber);
    }
    var deepestCell = "$" + columnLetter_(3 + depth) + rowNumber;
    terms.push("IF(" + deepestCell + "<>\"\"," + parts.join("&\"|||\"&") + ",\"\")");
  }
  return "TEXTJOIN(\"♦\",TRUE," + terms.join(",") + ")";
}


function formatSeasonalitySheet_(sheet, rowCount, header, settings) {
  if (rowCount <= 0) return;
  var colCount = header.length;
  sheet.getRange(1, 1, rowCount, colCount).setBackground(null).setFontWeight("normal");
  sheet.getRange(1, 1, 1, colCount).setBackground(HEADER_BACKGROUND).setFontWeight("bold");
  var boolRule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
  if (rowCount > 1) {
    ["category_winter", "category_spring", "category_summer", "category_autumn", "manual_winter", "manual_spring", "manual_summer", "manual_autumn", "winter", "spring", "summer", "autumn"].forEach(function(name) {
      var col = findHeaderIndex_(header, name) + 1;
      if (col > 0) sheet.getRange(2, col, rowCount - 1, 1).setDataValidation(boolRule);
    });
    var manualStartCol = findHeaderIndex_(header, "manual_winter") + 1;
    if (manualStartCol > 0) sheet.getRange(2, manualStartCol, rowCount - 1, 4).setBackground(MANUAL_BACKGROUND);
    var finalStartCol = findHeaderIndex_(header, "winter") + 1;
    if (finalStartCol > 0) sheet.hideColumns(finalStartCol, 4);
  }
  if (!settings || settings.enableSheetProtection) {
    applySeasonalityProtections_(sheet, header);
  } else {
    removeProtectionsForSheet_(sheet);
  }
  sheet.setFrozenRows(1);
}


function applySeasonalityProtections_(sheet, header) {
  try {
    removeProtectionsForSheet_(sheet);
    protectSeasonalityColumnBlock_(sheet, header, "category_winter", 4, "Seasonality category formulas");
    protectSeasonalityColumnBlock_(sheet, header, "winter", 4, "Seasonality final formulas");
  } catch (e) {
    Logger.log("Не вдалося оновити захист Seasonality: " + ((e && e.message) ? e.message : String(e)));
  }
}


function removeProtectionsForSheet_(sheet) {
  var types = [SpreadsheetApp.ProtectionType.SHEET, SpreadsheetApp.ProtectionType.RANGE];
  for (var t = 0; t < types.length; t++) {
    var protections = sheet.getProtections(types[t]);
    for (var i = 0; i < protections.length; i++) {
      if (protections[i].canEdit()) protections[i].remove();
    }
  }
}


function protectSeasonalityColumnBlock_(sheet, header, firstHeaderName, width, description) {
  var firstCol = findHeaderIndex_(header, firstHeaderName) + 1;
  if (firstCol <= 0 || width <= 0) return;
  var range = sheet.getRange(1, firstCol, sheet.getMaxRows(), width);
  var protection = range.protect().setDescription(description);
  var me = Session.getEffectiveUser();
  if (me) protection.addEditor(me);
  var editors = protection.getEditors();
  var meEmail = me ? me.getEmail() : "";
  var removable = [];
  for (var i = 0; i < editors.length; i++) {
    if (!meEmail || editors[i].getEmail() !== meEmail) removable.push(editors[i]);
  }
  if (removable.length > 0) protection.removeEditors(removable);
  if (me) protection.addEditor(me);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}


function seasonalityCellToBool_(value) {
  return value === true || safeTrim_(value).toLowerCase() === "true" || safeTrim_(value).toUpperCase() === "TRUE";
}


function getSeasonalityDecision_(product, seasonalityMap, settings) {
  if (!settings.enableSeasonalityFilter) return { allowed: true, hasSeasonTags: false };
  var entry = seasonalityMap[product.normId];
  if (!entry) return { allowed: true, hasSeasonTags: false };
  var checked = {
    winter: !!entry.winter,
    spring: !!entry.spring,
    summer: !!entry.summer,
    autumn: !!entry.autumn
  };
  var hasSeasonTags = checked.winter || checked.spring || checked.summer || checked.autumn;
  if (!hasSeasonTags) return { allowed: true, hasSeasonTags: false };
  var activeMatch =
    (checked.winter && settings.activeSeasonWinter) ||
    (checked.spring && settings.activeSeasonSpring) ||
    (checked.summer && settings.activeSeasonSummer) ||
    (checked.autumn && settings.activeSeasonAutumn);
  return { allowed: !!activeMatch, hasSeasonTags: true };
}


function pushReason_(reasons, reason) {
  if (!reason) return;
  for (var i = 0; i < reasons.length; i++) {
    if (reasons[i] === reason) return;
  }
  reasons.push(reason);
}


/* ================= Products output ================= */


function readProductsStateMap_(sheet, maxLevels) {
  var result = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;


  var width = Math.max(sheet.getLastColumn(), 4 + maxLevels);
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  var headerMap = buildHeaderIndexMap_(header);
  var data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var id = safeTrim_(row[0]);
    if (!id) continue;
    var funnelStage = getRowValueByHeaderOrIndex_(row, headerMap, "funnel_stage", 13 + maxLevels);
    var conversions = getRowValueByHeaderOrIndex_(row, headerMap, "conversions", 7 + maxLevels);
    var conversionValue = getRowValueByHeaderOrIndex_(row, headerMap, "conversion_value", 8 + maxLevels);
    var lastSeenFunnelStage = getRowValueByHeaderOrIndex_(row, headerMap, "last_seen_funnel_stage", -1);
    var lastSeenConversions = getRowValueByHeaderOrIndex_(row, headerMap, "last_seen_conversions", -1);
    var lastSeenConversionValue = getRowValueByHeaderOrIndex_(row, headerMap, "last_seen_conversion_value", -1);
    result[normOfferId_(id)] = {
      shopping: getRowValueByHeaderOrIndex_(row, headerMap, "excluded_destination_shopping", 1) || "",
      display: getRowValueByHeaderOrIndex_(row, headerMap, "excluded_destination_display", 2) || "",
      statusDate: getRowValueByHeaderOrIndex_(row, headerMap, "дата зміни статусу", 3) || "",
      hasDiagnostics: Object.prototype.hasOwnProperty.call(headerMap, "funnel_stage"),
      funnelStage: funnelStage || "",
      conversions: conversions || 0,
      conversionValue: conversionValue || 0,
      lastSeenFunnelStage: lastSeenFunnelStage || funnelStage || "",
      lastSeenConversions: lastSeenConversions !== "" ? lastSeenConversions : conversions,
      lastSeenConversionValue: lastSeenConversionValue !== "" ? lastSeenConversionValue : conversionValue,
      lastStageChangeDate: getRowValueByHeaderOrIndex_(row, headerMap, "last_stage_change_date", -1) || "",
      lastConversionAttributionDate: getRowValueByHeaderOrIndex_(row, headerMap, "last_conversion_attribution_date", -1) || "",
      attributionMap: readAttributionMapFromRow_(row, headerMap)
    };
  }
  return result;
}


function buildHeaderIndexMap_(header) {
  var result = {};
  for (var i = 0; i < header.length; i++) {
    var key = safeTrim_(header[i]).toLowerCase();
    if (key) result[key] = i;
  }
  return result;
}


function getRowValueByHeaderOrIndex_(row, headerMap, headerName, fallbackIndex) {
  var key = safeTrim_(headerName).toLowerCase();
  if (headerMap && Object.prototype.hasOwnProperty.call(headerMap, key)) {
    return row[headerMap[key]];
  }
  if (fallbackIndex >= 0 && fallbackIndex < row.length) return row[fallbackIndex];
  return "";
}


function makeEmptyAttributionMap_() {
  var result = {};
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    result[stages[i]] = {
      conversions: 0,
      conversionValue: 0
    };
  }
  return result;
}


function cloneAttributionMap_(source) {
  var result = makeEmptyAttributionMap_();
  source = source || {};
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    var stage = stages[i];
    if (!source[stage]) continue;
    result[stage].conversions = toNumber_(source[stage].conversions);
    result[stage].conversionValue = toNumber_(source[stage].conversionValue);
  }
  return result;
}


function readAttributionMapFromRow_(row, headerMap) {
  var result = makeEmptyAttributionMap_();
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    var convHeader = "attr_conversions_stage_" + (i + 1);
    var valueHeader = "attr_conversion_value_stage_" + (i + 1);
    result[stages[i]].conversions = toNumber_(getRowValueByHeaderOrIndex_(row, headerMap, convHeader, -1));
    result[stages[i]].conversionValue = toNumber_(getRowValueByHeaderOrIndex_(row, headerMap, valueHeader, -1));
  }
  return result;
}


function addAttributionDelta_(attributionMap, stage, conversionsDelta, valueDelta) {
  var normalizedStage = normalizeDashboardStage_(stage);
  if (!attributionMap[normalizedStage]) {
    attributionMap[normalizedStage] = {
      conversions: 0,
      conversionValue: 0
    };
  }
  attributionMap[normalizedStage].conversions += toNumber_(conversionsDelta);
  attributionMap[normalizedStage].conversionValue += toNumber_(valueDelta);
}


function appendAttributionHeaders_(header) {
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    header.push("attr_conversions_stage_" + (i + 1));
    header.push("attr_conversion_value_stage_" + (i + 1));
  }
}


function appendAttributionFieldsToRow_(row, attributionMap) {
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    var stageAgg = attributionMap[stages[i]] || {
      conversions: 0,
      conversionValue: 0
    };
    row.push(round2_(stageAgg.conversions));
    row.push(round2_(stageAgg.conversionValue));
  }
}


function buildProductsOutputRows_(merchantProducts, merchantMap, previousMap, productTypeRules, funnelStatsMap, activeQuarantineMap, seasonalityMap, productTypeBenchmarkRules, settings) {
  var rows = [];
  var today = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), DATE_FORMAT);
  var funnelDecorations = settings.enableFunnelBuilder ? calculateFunnelRows_(funnelStatsMap, settings) : {};
  var changed = 0;
  var categoryExcluded = 0;
  var seasonalityExcluded = 0;
  var quarantineExcluded = 0;


  merchantProducts.sort(function(a, b) {
    return naturalCmp_(a.offerId, b.offerId);
  });


  for (var i = 0; i < merchantProducts.length; i++) {
    var p = merchantProducts[i];
    var previous = previousMap[p.normId] || { shopping: "", display: "", statusDate: "" };
    var categoryAllowed = isAnyProductTypeAllowed_(p.productTypes, productTypeRules, settings.maxLevels, settings.enableProductTypeFilter);
    var quarantine = activeQuarantineMap[p.normId] || null;
    var seasonality = getSeasonalityDecision_(p, seasonalityMap, settings);
    var exclusionReasons = [];
    if (!categoryAllowed) pushReason_(exclusionReasons, "PRODUCT_TYPE_NOT_ALLOWED");
    if (!seasonality.allowed) pushReason_(exclusionReasons, "SEASONALITY");
    if (quarantine && quarantine.reasons) {
      var quarantineReasons = quarantine.reasons.split(",");
      for (var qr = 0; qr < quarantineReasons.length; qr++) pushReason_(exclusionReasons, safeTrim_(quarantineReasons[qr]));
    }
    var shouldExclude = exclusionReasons.length > 0;


    if (!categoryAllowed) categoryExcluded++;
    if (!seasonality.allowed) seasonalityExcluded++;
    if (quarantine) quarantineExcluded++;


    var newShopping = shouldExclude ? settings.shoppingExcludedValue : "";
    var newDisplay = shouldExclude ? settings.displayExcludedValue : "";
    var statusDate = previous.statusDate || "";


    if (safeTrim_(previous.shopping) !== newShopping || safeTrim_(previous.display) !== newDisplay) {
      statusDate = today;
      changed++;
    }


    var productType = chooseProductTypeForOutput_(p.productTypes, productTypeRules, settings.maxLevels, settings.enableProductTypeFilter);
    var productTypeFullPath = normalizeProductType_(productType);
    var productTypeAllPaths = buildProductTypeSearchText_(p.productTypes);
    var path = splitProductType_(productType, settings.maxLevels);
    var stats = funnelStatsMap[p.normId] || makeEmptyStats_(p);
    var funnel = funnelDecorations[p.normId] || makeEmptyFunnel_(p, settings);
    var currentFunnelStage = funnel.funnelStage || "";
    var productTypeBenchmarkLabel = chooseProductTypeBenchmarkLabel_(p.productTypes, productTypeBenchmarkRules, settings.maxLevels);
    var currentConversions = toNumber_(stats.conversions);
    var currentConversionValue = toNumber_(stats.conversionValue);
    var previousFunnelStage = previous.lastSeenFunnelStage || previous.funnelStage || "";
    var previousConversions = toNumber_(previous.lastSeenConversions);
    var previousConversionValue = toNumber_(previous.lastSeenConversionValue);
    var hasConversionHistory = !!previous.hasDiagnostics || !!previousFunnelStage;
    var conversionDelta = hasConversionHistory ? Math.max(0, currentConversions - previousConversions) : 0;
    var conversionValueDelta = hasConversionHistory ? Math.max(0, currentConversionValue - previousConversionValue) : 0;
    var conversionStageAttribution = conversionDelta > 0 ? (previousFunnelStage || currentFunnelStage || "6 без стат") : "";
    var attributionMap = cloneAttributionMap_(previous.attributionMap);
    var lastStageChangeDate = previous.lastStageChangeDate || "";
    var lastConversionAttributionDate = previous.lastConversionAttributionDate || "";


    if (previousFunnelStage && currentFunnelStage && previousFunnelStage !== currentFunnelStage) {
      lastStageChangeDate = today;
    }
    if (conversionDelta > 0) {
      addAttributionDelta_(attributionMap, conversionStageAttribution, conversionDelta, conversionValueDelta);
      lastConversionAttributionDate = today;
    }


    var row = [
      p.offerId,
      p.title || "",
      newShopping,
      newDisplay,
      statusDate,
      exclusionReasons.join(", "),
      p.dataSource || "",
      p.feedLabel || "",
      p.contentLanguage || "",
      p.categoryMatchId || "",
      p.productTypeSource || "",
      p.productTypeStatus || "",
      productTypeFullPath,
      productTypeAllPaths
    ];


    for (var level = 0; level < settings.maxLevels; level++) row.push(path[level] || "");


    row.push(
      stats.impressions || 0,
      stats.clicks || 0,
      stats.cost || 0,
      p.price || 0,
      stats.conversions || 0,
      stats.conversionValue || 0,
      funnel.roas || 0,
      funnel.salesStatus || "",
      funnel.clickSegment || "",
      funnel.impressionSegment || "",
      currentFunnelStage,
      funnel.benchmarkGroup || p.benchmarkGroup || settings.defaultBenchmarkGroup,
      productTypeBenchmarkLabel,
      quarantine ? "YES" : "",
      quarantine ? quarantine.activeUntil : "",
      quarantine ? quarantine.reasons : "",
      categoryAllowed ? "YES" : ""
    );


    row.push(
      previousFunnelStage,
      currentFunnelStage,
      previousConversions,
      currentConversions,
      conversionDelta,
      previousConversionValue,
      currentConversionValue,
      conversionValueDelta,
      conversionStageAttribution,
      currentFunnelStage,
      currentConversions,
      currentConversionValue,
      lastStageChangeDate,
      lastConversionAttributionDate
    );
    appendAttributionFieldsToRow_(row, attributionMap);


    rows.push(row);
  }


  Logger.log("Products: змінених статусів: " + changed);
  Logger.log("Products: виключено по ProductTypes: " + categoryExcluded);
  Logger.log("Products: виключено по Seasonality: " + seasonalityExcluded);
  Logger.log("Products: виключено по карантину: " + quarantineExcluded);
  return rows;
}


function writeProductsSheet_(sheet, rows, settings) {
  var idx = getOutputRowIndexes_(settings.maxLevels);
  var output = [];
  var includeBenchmarkLabel = shouldWriteProductsBenchmarkLabel_(settings);


  for (var r = 0; r < rows.length; r++) {
    var outRow = [
      rows[r][idx.id],
      rows[r][idx.shopping],
      rows[r][idx.display],
      rows[r][idx.funnelStage] || ""
    ];
    if (includeBenchmarkLabel) outRow.push(rows[r][idx.productTypeBenchmarkLabel] || "");
    output.push(outRow);
  }


  var lastRowToClear = Math.max(sheet.getLastRow(), output.length + 1);
  var outputColCount = includeBenchmarkLabel ? 5 : 4;
  if (lastRowToClear > 1) sheet.getRange(2, 1, lastRowToClear - 1, Math.max(5, outputColCount)).clearContent();


  sheet.getRange(1, 1, 1, 3).setValues([["id", "excluded_destination", "excluded_destination"]]);
  ensureProductsFunnelHeaderFormula_(sheet, settings);
  ensureProductsBenchmarkHeaderFormula_(sheet, settings, includeBenchmarkLabel);
  writeRowsInChunks_(sheet, 2, 1, output, settings.writeChunkSize, "Products");


  if (settings.enableManagedSheetFormatting) {
    formatProductsSheet_(sheet, output.length + 1, outputColCount);
  }
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, 1).setNumberFormat("@");
}


function ensureProductsFunnelHeaderFormula_(sheet, settings) {
  var cell = sheet.getRange(1, 4);
  if (cell.getFormula()) return;
  cell.setFormula(buildProductsFunnelHeaderFormula_(settings));
}


function buildProductsFunnelHeaderFormula_(settings) {
  var settingsSheetName = settings.settingsSheetName || SETTINGS_SHEET_NAME;
  var fallback = safeTrim_(settings.funnelStageOutputAttribute).toLowerCase() || "custom_label_2";
  return '=IFERROR(VLOOKUP("funnel_stage_output_attribute",' +
    quoteSheetNameForFormula_(settingsSheetName) + '!A:B,2,FALSE),"' + fallback + '")';
}


function shouldWriteProductsBenchmarkLabel_(settings) {
  var benchmarkField = safeTrim_(settings.benchmarkLabelField).toLowerCase();
  var funnelField = safeTrim_(settings.funnelStageOutputAttribute).toLowerCase();
  return isValidFeedCustomLabelHeader_(benchmarkField) && benchmarkField !== funnelField;
}


function ensureProductsBenchmarkHeaderFormula_(sheet, settings, enabled) {
  var cell = sheet.getRange(1, 5);
  if (!enabled) {
    cell.clearContent();
    return;
  }
  if (cell.getFormula()) return;
  cell.setFormula(buildProductsBenchmarkHeaderFormula_(settings));
}


function buildProductsBenchmarkHeaderFormula_(settings) {
  var settingsSheetName = settings.settingsSheetName || SETTINGS_SHEET_NAME;
  var fallback = safeTrim_(settings.benchmarkLabelField).toLowerCase() || "custom_label_4";
  return '=IFERROR(VLOOKUP("benchmark_label_field",' +
    quoteSheetNameForFormula_(settingsSheetName) + '!A:B,2,FALSE),"' + fallback + '")';
}


function quoteSheetNameForFormula_(sheetName) {
  return "'" + String(sheetName).replace(/'/g, "''") + "'";
}


function formatProductsSheet_(sheet, rowCount, colCount) {
  if (rowCount <= 0) return;
  var width = Math.max(colCount || 4, 4);
  sheet.getRange(1, 1, rowCount, width).setBackground(null).setFontWeight("normal");
  sheet.getRange(1, 1, 1, width).setBackground(HEADER_BACKGROUND).setFontWeight("bold");
  sheet.setFrozenRows(1);
}


function writeProductDiagnosticsSheet_(sheet, rows, settings) {
  var maxLevels = settings.maxLevels;
  var header = [
    "id",
    "title",
    "excluded_destination_shopping",
    "excluded_destination_display",
    "дата зміни статусу",
    "exclusion_reasons"
  ];
  header.push("data_source_id", "feed_label", "content_language", "category_match_id", "product_type_source", "product_type_status");
  header.push("product_type_full_path", "product_type_all_paths");


  for (var i = 1; i <= maxLevels; i++) header.push("product_type_l" + i);


  header.push(
    "impressions",
    "clicks",
    "cost",
    "price",
    "conversions",
    "conversion_value",
    "roas",
    "sales_status",
    "click_segment",
    "impression_segment",
    "funnel_stage",
    "benchmark_group",
    "product_type_benchmark_label",
    "quarantine_active",
    "quarantine_release",
    "quarantine_reasons",
    "category_allowed"
  );
  header.push(
    "previous_funnel_stage",
    "current_funnel_stage",
    "previous_conversions",
    "current_conversions",
    "conversion_delta",
    "previous_conversion_value",
    "current_conversion_value",
    "conversion_value_delta",
    "conversion_stage_attribution",
    "last_seen_funnel_stage",
    "last_seen_conversions",
    "last_seen_conversion_value",
    "last_stage_change_date",
    "last_conversion_attribution_date"
  );
  appendAttributionHeaders_(header);


  var startDataRow = Math.max(1, Number(settings.productDiagnosticsStartRow) || 1);
  var startIndex = startDataRow - 1;
  var rowsToWrite = rows.slice(startIndex);


  if (startDataRow <= 1) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    Logger.log("ProductDiagnostics resume: start data row " + startDataRow + ", skip first " + startIndex + " rows.");
  }


  writeRowsInChunks_(sheet, startDataRow + 1, 1, rowsToWrite, settings.writeChunkSize, "ProductDiagnostics");
  if (settings.enableManagedSheetFormatting && startDataRow <= 1) {
    formatProductDiagnosticsSheet_(sheet, rows.length + 1, header.length);
  }
  if (rowsToWrite.length > 0) sheet.getRange(startDataRow + 1, 1, rowsToWrite.length, 1).setNumberFormat("@");
}


function writeRowsInChunks_(sheet, startRow, startCol, rows, chunkSize, label) {
  if (!rows || rows.length === 0) return;
  var size = Math.max(1, Number(chunkSize) || 5000);
  var totalChunks = Math.ceil(rows.length / size);
  for (var offset = 0; offset < rows.length; offset += size) {
    var chunk = rows.slice(offset, offset + size);
    var chunkNumber = Math.floor(offset / size) + 1;
    Logger.log(label + ": запис блоку " + chunkNumber + "/" + totalChunks + ", рядки " + (offset + 1) + "-" + (offset + chunk.length));
    sheet.getRange(startRow + offset, startCol, chunk.length, chunk[0].length).setValues(chunk);
  }
}


function formatProductDiagnosticsSheet_(sheet, rowCount, colCount) {
  if (rowCount <= 0 || colCount <= 0) return;
  sheet.getRange(1, 1, rowCount, colCount).setBackground(null).setFontWeight("normal");
  sheet.getRange(1, 1, 1, colCount).setBackground(HEADER_BACKGROUND).setFontWeight("bold");
  if (rowCount > 1) {
    var header = sheet.getRange(1, 1, 1, colCount).getValues()[0];
    var currencyFormat = currencyNumberFormat_(getAccountCurrencyCode_());
    setDiagnosticsNumberFormat_(sheet, header, "cost", rowCount, currencyFormat);
    setDiagnosticsNumberFormat_(sheet, header, "price", rowCount, currencyFormat);
    setDiagnosticsNumberFormat_(sheet, header, "conversion_value", rowCount, currencyFormat);
    setDiagnosticsNumberFormat_(sheet, header, "previous_conversion_value", rowCount, currencyFormat);
    setDiagnosticsNumberFormat_(sheet, header, "current_conversion_value", rowCount, currencyFormat);
    setDiagnosticsNumberFormat_(sheet, header, "conversion_value_delta", rowCount, currencyFormat);
  }
  sheet.setFrozenRows(1);
}


function setDiagnosticsNumberFormat_(sheet, header, headerName, rowCount, format) {
  var col = findHeaderIndex_(header, headerName) + 1;
  if (col > 0) sheet.getRange(2, col, rowCount - 1, 1).setNumberFormat(format);
}


function makeEmptyStats_(merchantProduct) {
  return {
    offerIdOut: merchantProduct.offerId,
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conversionValue: 0,
    benchmarkGroup: merchantProduct.benchmarkGroup
  };
}


function makeEmptyFunnel_(merchantProduct, settings) {
  return {
    roas: 0,
    salesStatus: "без стат",
    clickSegment: "низькі кліки",
    impressionSegment: "низькі покази",
    funnelStage: "6 без стат",
    benchmarkGroup: merchantProduct.benchmarkGroup || settings.defaultBenchmarkGroup
  };
}


/* ================= Dashboard ================= */


function runDashboardFromDiagnostics_(ss, sheets, settings) {
  if (!settings.enableDashboardData && !settings.enableDashboard) {
    Logger.log("Dashboard з ProductDiagnostics пропущено: enable_dashboard_data=false і enable_dashboard=false.");
    return;
  }


  Logger.log("Reading ProductDiagnostics for Dashboard...");
  var source = readDashboardSourceFromDiagnostics_(sheets.productDiagnostics, settings);
  if (source.outputRows.length === 0) {
    throw new Error("ProductDiagnostics порожній. Спочатку побудуй ProductDiagnostics.");
  }
  Logger.log("ProductDiagnostics rows for Dashboard: " + source.outputRows.length);


  var statsMap = buildStatsMapFromOutputRows_(source.outputRows, settings);
  if (settings.enableDashboardData) {
    Logger.log("Writing DashboardData from ProductDiagnostics...");
    writeDashboardDataSheet_(sheets.dashboardData, source.outputRows, source.merchantProducts, statsMap, statsMap, settings);
    Logger.log("DashboardData written.");
  } else {
    Logger.log("DashboardData пропущено через enable_dashboard_data=false.");
  }


  if (settings.enableDashboard) {
    Logger.log("Ensuring Dashboard from ProductDiagnostics...");
    ensureDashboardSheet_(sheets.dashboard, settings);
    Logger.log("Dashboard ready.");
  } else {
    Logger.log("Dashboard пропущено через enable_dashboard=false.");
  }


  ensureCoreSheetOrder_(ss, sheets.products, sheets.dashboard, sheets.dashboardData);
  hideDefaultBlankSheets_(ss, sheets);
  if (settings.enableSheetProtection) {
    Logger.log("Updating sheet protection...");
    protectManagedSheets_(ss, settings);
    Logger.log("Sheet protection updated.");
  } else {
    Logger.log("Захист листів пропущено через enable_sheet_protection=false.");
  }
  Logger.log("Dashboard from ProductDiagnostics completed.");
}


function readDashboardSourceFromDiagnostics_(sheet, settings) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return {
      outputRows: [],
      merchantProducts: []
    };
  }


  var idx = getOutputRowIndexes_(settings.maxLevels);
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var outputRows = [];
  var merchantProducts = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var offerId = safeTrim_(row[idx.id]);
    if (!offerId) continue;
    outputRows.push(row);
    merchantProducts.push({
      offerId: offerId,
      normId: normOfferId_(offerId),
      benchmarkGroup: safeTrim_(row[idx.benchmarkGroup]) || settings.defaultBenchmarkGroup
    });
  }


  return {
    outputRows: outputRows,
    merchantProducts: merchantProducts
  };
}


function buildStatsMapFromOutputRows_(outputRows, settings) {
  var idx = getOutputRowIndexes_(settings.maxLevels);
  var map = {};
  for (var i = 0; i < outputRows.length; i++) {
    var row = outputRows[i];
    var offerId = safeTrim_(row[idx.id]);
    if (!offerId) continue;
    map[normOfferId_(offerId)] = {
      offerIdOut: offerId,
      impressions: toNumber_(row[idx.impressions]),
      clicks: toNumber_(row[idx.clicks]),
      cost: toNumber_(row[idx.cost]),
      conversions: toNumber_(row[idx.conversions]),
      conversionValue: toNumber_(row[idx.conversionValue]),
      benchmarkGroup: safeTrim_(row[idx.benchmarkGroup]) || settings.defaultBenchmarkGroup
    };
  }
  return map;
}


function getDashboardPeriodStatsMap_(days, reusableMap, merchantMap, settings) {
  if (reusableMap) return reusableMap;
  var statsMap = getAdsStatsMap_(days, 0);
  enrichStatsWithMerchantData_(statsMap, merchantMap, settings);
  return statsMap;
}


function writeDashboardDataSheet_(sheet, outputRows, merchantProducts, stats14Map, stats30Map, settings) {
  var shouldFormatDashboardData = sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
  if (shouldFormatDashboardData) {
    sheet.clear();
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  } else {
    sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), Math.max(1, sheet.getLastColumn())).clearContent();
  }
  try {
    sheet.showSheet();
  } catch (e) {
    Logger.log("DashboardData could not be shown: " + ((e && e.message) ? e.message : String(e)));
  }
  ensureDashboardSheetSize_(sheet, 160, 16);


  var funnelPeriod = getDateRange_(settings.funnelDaysAgo, 0);
  var period14 = getDateRange_(14, 0);
  var period30 = getDateRange_(30, 0);
  var groupDefs = buildDashboardGroupDefinitions_(outputRows, settings);
  var currencyCode = getAccountCurrencyCode_();
  var currencyFormat = currencyNumberFormat_(currencyCode);
  var periodRows = buildDashboardPeriodRows_(settings, funnelPeriod, period14, period30);
  var summaryRows = buildDashboardSummaryRows_(merchantProducts, stats14Map, stats30Map, period14, period30);
  var budgetRows = buildDashboardBudgetRows_(groupDefs);
  var stageSpendRows = buildDashboardStageSpendRows_(groupDefs, settings);
  var dashboardColCount = Math.max(16, stageSpendRows[0].length);
  ensureDashboardSheetSize_(sheet, 160, dashboardColCount);


  var title = "Unified Product Control DashboardData";
  sheet.getRange(1, 1).setValue(title);
  if (shouldFormatDashboardData) {
    sheet.getRange(1, 1, 1, dashboardColCount).setBackground("#1c4587").setFontColor("#ffffff").setFontWeight("bold");
  }


  writeDashboardBlock_(sheet, 3, 1, "Періоди даних", periodRows, shouldFormatDashboardData);
  writeDashboardBlock_(sheet, 9, 1, "Загальна сводка", summaryRows, shouldFormatDashboardData);
  if (shouldFormatDashboardData) formatDashboardSummaryUnits_(sheet, 10, summaryRows.length, currencyFormat);
  writeDashboardBlock_(sheet, 9, 12, "Доля витрат за групами - " + formatPeriodLabel_(funnelPeriod), budgetRows, shouldFormatDashboardData);
  if (shouldFormatDashboardData) formatDashboardBudgetUnits_(sheet, 10, budgetRows.length, currencyFormat);
  writeDashboardBlock_(sheet, 17, 1, "Витрати за групами та етапами - " + formatPeriodLabel_(funnelPeriod), stageSpendRows, shouldFormatDashboardData);
  if (shouldFormatDashboardData) formatDashboardStageSpendUnits_(sheet, 18, stageSpendRows.length, stageSpendRows[0].length, currencyFormat);


  var startRow = 17 + stageSpendRows.length + 3;
  for (var i = 0; i < groupDefs.length; i++) {
    var blockRows = buildDashboardFunnelRows_(groupDefs[i], settings, currencyCode);
    writeDashboardBlock_(sheet, startRow, 1, groupDefs[i].label + " - " + formatPeriodLabel_(funnelPeriod), blockRows, shouldFormatDashboardData);
    if (shouldFormatDashboardData) formatDashboardFunnelUnits_(sheet, startRow + 1, blockRows.length, currencyFormat);
    startRow += blockRows.length + 3;
  }


  if (shouldFormatDashboardData) formatDashboardDataSheet_(sheet, startRow + 2, dashboardColCount);
}


function writeDashboardBlock_(sheet, startRow, startCol, title, rows, shouldFormat) {
  if (!rows || rows.length === 0) return;
  var width = rows[0].length;
  sheet.getRange(startRow, startCol).setValue(title);
  if (shouldFormat) {
    sheet.getRange(startRow, startCol, 1, Math.max(16 - startCol + 1, width))
      .setBackground("#4a86e8")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
  }
  sheet.getRange(startRow + 1, startCol, rows.length, width).setValues(rows);
  if (shouldFormat) sheet.getRange(startRow + 1, startCol, 1, width).setBackground(HEADER_BACKGROUND).setFontWeight("bold");
}


function formatDashboardSummaryUnits_(sheet, headerRow, rowCount, currencyFormat) {
  var dataRows = Math.max(0, rowCount - 1);
  if (dataRows <= 0) return;
  var firstDataRow = headerRow + 1;
  sheet.getRange(firstDataRow, 4, dataRows, 2).setNumberFormat('#,##0 "шт"');
  sheet.getRange(firstDataRow, 6, dataRows, 1).setNumberFormat(currencyFormat);
  sheet.getRange(firstDataRow, 7, dataRows, 1).setNumberFormat("#,##0.##");
  sheet.getRange(firstDataRow, 8, dataRows, 2).setNumberFormat(currencyFormat);
  sheet.getRange(firstDataRow, 10, dataRows, 1).setNumberFormat("0.00");
}


function formatDashboardBudgetUnits_(sheet, headerRow, rowCount, currencyFormat) {
  var dataRows = Math.max(0, rowCount - 1);
  if (dataRows <= 0) return;
  var firstDataRow = headerRow + 1;
  sheet.getRange(firstDataRow, 13, dataRows, 2).setNumberFormat('#,##0 "шт"');
  sheet.getRange(firstDataRow, 15, dataRows, 1).setNumberFormat(currencyFormat);
  sheet.getRange(firstDataRow, 16, dataRows, 1).setNumberFormat("0.00%");
}


function formatDashboardStageSpendUnits_(sheet, headerRow, rowCount, colCount, currencyFormat) {
  var dataRows = Math.max(0, rowCount - 1);
  var currencyCols = Math.max(0, colCount - 1);
  if (dataRows <= 0 || currencyCols <= 0) return;
  sheet.getRange(headerRow + 1, 2, dataRows, currencyCols).setNumberFormat(currencyFormat);
}


function formatDashboardFunnelUnits_(sheet, headerRow, rowCount, currencyFormat) {
  var dataRows = Math.max(0, rowCount - 1);
  if (dataRows <= 0) return;
  var firstDataRow = headerRow + 1;
  sheet.getRange(firstDataRow, 2, dataRows, 1).setNumberFormat('#,##0 "шт"');
  sheet.getRange(firstDataRow, 3, dataRows, 2).setNumberFormat("#,##0");
  sheet.getRange(firstDataRow, 5, dataRows, 1).setNumberFormat("#,##0.##");
  sheet.getRange(firstDataRow, 6, dataRows, 2).setNumberFormat(currencyFormat);
  sheet.getRange(firstDataRow, 8, dataRows, 1).setNumberFormat("0.00");
  sheet.getRange(firstDataRow, 9, dataRows, 1).setNumberFormat(currencyFormat);
  sheet.getRange(firstDataRow, 10, dataRows, 1).setNumberFormat("@");
  sheet.getRange(firstDataRow, 11, dataRows, 1).setNumberFormat("@");
  sheet.getRange(firstDataRow, 12, dataRows, 1).setNumberFormat("#,##0.##");
  sheet.getRange(firstDataRow, 13, dataRows, 1).setNumberFormat(currencyFormat);
  sheet.getRange(firstDataRow, 14, dataRows, 1).setNumberFormat(currencyFormat);
}


function ensureDashboardSheetSize_(sheet, minRows, minCols) {
  if (sheet.getMaxRows() < minRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), minRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < minCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), minCols - sheet.getMaxColumns());
  }
}


function buildDashboardPeriodRows_(settings, funnelPeriod, period14, period30) {
  return [
    ["Блок", "Днів", "Дата з", "Дата по", "Коментар"],
    ["Funnel Builder / групові таблиці", Number(settings.funnelDaysAgo) || 0, formatDateForDashboard_(funnelPeriod.start), formatDateForDashboard_(funnelPeriod.end), "Включно. Цей період використовується для ProductDiagnostics, funnel_stage, benchmark-груп і нижніх групових таблиць."],
    ["Загальна сводка 14 днів", 14, formatDateForDashboard_(period14.start), formatDateForDashboard_(period14.end), "Включно. Окремий запит Google Ads stats."],
    ["Загальна сводка 30 днів", 30, formatDateForDashboard_(period30.start), formatDateForDashboard_(period30.end), "Включно. Також використовується для ProductTypes 30d, якщо Product Type filter увімкнено."]
  ];
}


function buildDashboardSummaryRows_(merchantProducts, stats14Map, stats30Map, period14, period30) {
  return [
    ["Період", "Дата з", "Дата по", "Товарів", "Проклікано товарів", "Витрати", "Конверсії", "CPA", "CValue", "ROAS"],
    buildDashboardSummaryRow_("14 днів", merchantProducts, stats14Map, period14),
    buildDashboardSummaryRow_("30 днів", merchantProducts, stats30Map, period30)
  ];
}


function buildDashboardSummaryRow_(label, merchantProducts, statsMap, period) {
  var summary = summarizeStatsMap_(statsMap, merchantProducts);
  return [
    label,
    formatDateForDashboard_(period.start),
    formatDateForDashboard_(period.end),
    merchantProducts.length,
    summary.clickedProducts,
    round2_(summary.cost),
    round2_(summary.conversions),
    round2_(summary.conversions > 0 ? summary.cost / summary.conversions : 0),
    round2_(summary.conversionValue),
    round2_(summary.cost > 0 ? summary.conversionValue / summary.cost : 0)
  ];
}


function summarizeStatsMap_(statsMap, merchantProducts) {
  var merchantIds = {};
  for (var i = 0; i < merchantProducts.length; i++) merchantIds[merchantProducts[i].normId] = true;


  var result = {
    clickedProducts: 0,
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conversionValue: 0
  };


  statsMap = statsMap || {};
  for (var normId in statsMap) {
    if (!statsMap.hasOwnProperty(normId) || !merchantIds[normId]) continue;
    var item = statsMap[normId];
    if ((item.clicks || 0) > 0) result.clickedProducts++;
    result.impressions += item.impressions || 0;
    result.clicks += item.clicks || 0;
    result.cost += item.cost || 0;
    result.conversions += item.conversions || 0;
    result.conversionValue += item.conversionValue || 0;
  }


  return result;
}


function formatPeriodLabel_(range) {
  return getInclusiveDaysCount_(range) + " днів, " +
    formatDateForDashboard_(range.start) + " - " +
    formatDateForDashboard_(range.end) + " включно";
}


function formatDateForDashboard_(dateString) {
  var parts = String(dateString).split("-");
  if (parts.length !== 3) return dateString;
  return parts[2] + "." + parts[1] + "." + parts[0];
}


function getInclusiveDaysCount_(range) {
  var start = parseDateFlexible_(range.start);
  var end = parseDateFlexible_(range.end);
  if (!start || !end) return "";
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}


function buildDashboardGroupDefinitions_(outputRows, settings) {
  var byGroup = {};
  var defaultGroup = safeTrim_(settings.defaultBenchmarkGroup) || "other";


  for (var i = 0; i < outputRows.length; i++) {
    var row = outputRows[i];
    var idx = getOutputRowIndexes_(settings.maxLevels);
    var group = safeTrim_(row[idx.benchmarkGroup]) || defaultGroup;
    if (!byGroup[group]) byGroup[group] = makeDashboardGroup_(group);
    addDashboardRowToGroup_(byGroup[group], row, settings);
  }


  var groups = [];
  for (var groupName in byGroup) {
    if (byGroup.hasOwnProperty(groupName)) groups.push(byGroup[groupName]);
  }
  groups.sort(function(a, b) {
    var aDefault = isDefaultDashboardGroup_(a.key, defaultGroup);
    var bDefault = isDefaultDashboardGroup_(b.key, defaultGroup);
    if (aDefault !== bDefault) return aDefault ? 1 : -1;
    return naturalCmp_(a.key, b.key);
  });


  var result = [makeDashboardAllGroup_(outputRows, settings)];
  for (var g = 0; g < groups.length; g++) result.push(groups[g]);
  return result;


  var other = makeDashboardGroup_("Інші групи");
  other.label = "Група: Інші групи";
}


function isDefaultDashboardGroup_(groupName, defaultGroup) {
  var value = safeTrim_(groupName).toLowerCase();
  return value === safeTrim_(defaultGroup).toLowerCase() || value === "other" || value === "інше";
}


function makeDashboardAllGroup_(outputRows, settings) {
  var group = makeDashboardGroup_("Весь асортимент");
  group.label = "Весь асортимент";
  for (var i = 0; i < outputRows.length; i++) addDashboardRowToGroup_(group, outputRows[i], settings);
  return group;
}


function makeDashboardGroup_(key) {
  return {
    key: key,
    label: "Група: " + key,
    products: 0,
    clickedProducts: 0,
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conversionValue: 0,
    stageMap: {}
  };
}


function addDashboardRowToGroup_(group, row, settings) {
  var idx = getOutputRowIndexes_(settings.maxLevels);
  var stage = safeTrim_(row[idx.funnelStage]) || "6 без стат";
  var clicks = toNumber_(row[idx.clicks]);
  var impressions = toNumber_(row[idx.impressions]);
  var cost = toNumber_(row[idx.cost]);
  var conversions = toNumber_(row[idx.conversions]);
  var conversionValue = toNumber_(row[idx.conversionValue]);


  group.products++;
  if (clicks > 0) group.clickedProducts++;
  group.impressions += impressions;
  group.clicks += clicks;
  group.cost += cost;
  group.conversions += conversions;
  group.conversionValue += conversionValue;


  if (!group.stageMap[stage]) group.stageMap[stage] = makeDashboardStageAggregate_();
  var stageAgg = group.stageMap[stage];
  stageAgg.products++;
  if (clicks > 0) stageAgg.clickedProducts++;
  stageAgg.impressions += impressions;
  stageAgg.clicks += clicks;
  stageAgg.cost += cost;
  stageAgg.conversions += conversions;
  stageAgg.conversionValue += conversionValue;


  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    var attributedStage = stages[i];
    if (!group.stageMap[attributedStage]) group.stageMap[attributedStage] = makeDashboardStageAggregate_();
    group.stageMap[attributedStage].attributedConversions += toNumber_(row[idx.attrStageStart + i * 2]);
    group.stageMap[attributedStage].attributedConversionValue += toNumber_(row[idx.attrStageStart + i * 2 + 1]);
  }
}


function makeDashboardStageAggregate_() {
  return {
    products: 0,
    clickedProducts: 0,
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conversionValue: 0,
    attributedConversions: 0,
    attributedConversionValue: 0
  };
}


function mergeDashboardGroup_(target, source) {
  target.products += source.products;
  target.clickedProducts += source.clickedProducts;
  target.impressions += source.impressions;
  target.clicks += source.clicks;
  target.cost += source.cost;
  target.conversions += source.conversions;
  target.conversionValue += source.conversionValue;


  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    var stage = stages[i];
    var sourceStage = source.stageMap[stage] || makeDashboardStageAggregate_();
    if (!target.stageMap[stage]) target.stageMap[stage] = makeDashboardStageAggregate_();
    target.stageMap[stage].products += sourceStage.products;
    target.stageMap[stage].clickedProducts += sourceStage.clickedProducts;
    target.stageMap[stage].impressions += sourceStage.impressions;
    target.stageMap[stage].clicks += sourceStage.clicks;
    target.stageMap[stage].cost += sourceStage.cost;
    target.stageMap[stage].conversions += sourceStage.conversions;
    target.stageMap[stage].conversionValue += sourceStage.conversionValue;
    target.stageMap[stage].attributedConversions += sourceStage.attributedConversions || 0;
    target.stageMap[stage].attributedConversionValue += sourceStage.attributedConversionValue || 0;
  }
}


function buildDashboardBudgetRows_(groupDefs) {
  var totalCost = groupDefs.length > 0 ? groupDefs[0].cost : 0;
  var rows = [["Група", "Товарів", "Проклікано", "Витрати", "Доля витрат"]];
  for (var i = 0; i < groupDefs.length; i++) {
    rows.push([
      groupDefs[i].label.replace(/^Група: /, ""),
      groupDefs[i].products,
      groupDefs[i].clickedProducts,
      round2_(groupDefs[i].cost),
      totalCost > 0 ? groupDefs[i].cost / totalCost : 0
    ]);
  }
  return rows;
}


function buildDashboardStageSpendRows_(groupDefs, settings) {
  var stages = getDashboardFunnelStages_();
  var rows = [["funnel_stage"]];
  for (var g = 0; g < groupDefs.length; g++) rows[0].push(groupDefs[g].label.replace(/^Група: /, ""));


  for (var i = 0; i < stages.length; i++) {
    var row = [stages[i]];
    for (var j = 0; j < groupDefs.length; j++) {
      var agg = groupDefs[j].stageMap[stages[i]] || makeDashboardStageAggregate_();
      row.push(round2_(agg.cost));
    }
    rows.push(row);
  }


  return rows;
}


function buildDashboardFunnelRows_(group, settings, currencyCode) {
  var stages = getDashboardFunnelStages_();
  var totalAttributedConversions = sumAttributedConversions_(group);
  var totalAttributedValue = sumAttributedConversionValue_(group);
  var rows = [["funnel_stage", "\u0422\u043e\u0432\u0430\u0440\u0456\u0432", "\u041f\u043e\u043a\u0430\u0437\u0438", "\u041a\u043b\u0456\u043a\u0438", "\u041a\u043e\u043d\u0432\u0435\u0440\u0441\u0456\u0457", "CValue", "\u0412\u0438\u0442\u0440\u0430\u0442\u0438", "ROAS", "CPA", "CPC", "CR", "attr_conversions", "attr_cvalue", "attr_cpa"]];
  for (var i = 0; i < stages.length; i++) {
    var stage = stages[i];
    var agg = group.stageMap[stage] || makeDashboardStageAggregate_();
    rows.push([
      stage,
      agg.products,
      round2_(agg.impressions),
      round2_(agg.clicks),
      round2_(agg.conversions),
      round2_(agg.conversionValue),
      round2_(agg.cost),
      round2_(agg.cost > 0 ? agg.conversionValue / agg.cost : 0),
      round2_(agg.conversions > 0 ? agg.cost / agg.conversions : 0),
      formatCurrencyText_(agg.clicks > 0 ? agg.cost / agg.clicks : 0, currencyCode),
      formatPercent2_(agg.clicks > 0 ? agg.conversions / agg.clicks : 0),
      round2_(agg.attributedConversions || 0),
      round2_(agg.attributedConversionValue || 0),
      round2_((agg.attributedConversions || 0) > 0 ? agg.cost / agg.attributedConversions : 0)
    ]);
  }
  rows.push([
    "\u0420\u0430\u0437\u043e\u043c",
    group.products,
    round2_(group.impressions),
    round2_(group.clicks),
    round2_(group.conversions),
    round2_(group.conversionValue),
    round2_(group.cost),
    round2_(group.cost > 0 ? group.conversionValue / group.cost : 0),
    round2_(group.conversions > 0 ? group.cost / group.conversions : 0),
    formatCurrencyText_(group.clicks > 0 ? group.cost / group.clicks : 0, currencyCode),
    formatPercent2_(group.clicks > 0 ? group.conversions / group.clicks : 0),
    round2_(totalAttributedConversions),
    round2_(totalAttributedValue),
    round2_(totalAttributedConversions > 0 ? group.cost / totalAttributedConversions : 0)
  ]);
  return rows;
}


function sumAttributedConversions_(group) {
  var sum = 0;
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    var agg = group.stageMap[stages[i]];
    if (agg) sum += agg.attributedConversions || 0;
  }
  return sum;
}


function sumAttributedConversionValue_(group) {
  var sum = 0;
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    var agg = group.stageMap[stages[i]];
    if (agg) sum += agg.attributedConversionValue || 0;
  }
  return sum;
}


function getDashboardFunnelStages_() {
  return ["1 продажі", "2 вк+вп", "3 вк+нп", "4 нк+вп", "5 нк+нп", "6 без стат"];
}


function normalizeDashboardStage_(stage) {
  var value = safeTrim_(stage);
  var stages = getDashboardFunnelStages_();
  for (var i = 0; i < stages.length; i++) {
    if (value === stages[i]) return stages[i];
  }
  return stages[stages.length - 1];
}


function getOutputRowIndexes_(maxLevels) {
  var metaStart = 6;
  var metaCols = 8;
  var levelStart = metaStart + metaCols;
  var statsStart = levelStart + maxLevels;
  var attributionStart = statsStart + 17 + 14;
  return {
    id: 0,
    title: 1,
    shopping: 2,
    display: 3,
    statusDate: 4,
    exclusionReasons: 5,
    impressions: statsStart,
    clicks: statsStart + 1,
    cost: statsStart + 2,
    price: statsStart + 3,
    conversions: statsStart + 4,
    conversionValue: statsStart + 5,
    funnelStage: statsStart + 10,
    benchmarkGroup: statsStart + 11,
    productTypeBenchmarkLabel: statsStart + 12,
    attrStageStart: attributionStart
  };
}


function formatDashboardDataSheet_(sheet, rowCount, colCount) {
  sheet.getRange(1, 1).setFontSize(16).setFontWeight("bold").setBackground("#1c4587").setFontColor("#ffffff");
  sheet.getRange(1, 1, 1, 16).setBackground("#1c4587").setFontColor("#ffffff");
  sheet.setFrozenRows(1);


  var lastRow = sheet.getLastRow();
  var lastCol = Math.min(16, sheet.getLastColumn());


  for (var r = 1; r <= lastRow; r++) {
    var rowValues = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    if (rowValues[0] === "Період" || rowValues[0] === "Блок" || rowValues[0] === "Група" || rowValues[0] === "funnel_stage") {
      sheet.getRange(r, 1, 1, lastCol).setBackground(HEADER_BACKGROUND).setFontWeight("bold");
    }
    if (rowValues[0] === "Разом") {
      sheet.getRange(r, 1, 1, lastCol).setBackground(HEADER_BACKGROUND).setFontWeight("bold");
    }
  }


  sheet.getDataRange().setVerticalAlignment("middle");
  sheet.getRange(1, 1, Math.max(1, rowCount), Math.max(1, colCount)).setWrap(false);
  setDashboardDataColumnWidths_(sheet);
}


function setDashboardDataColumnWidths_(sheet) {
  var widths = [170, 76, 82, 82, 260, 82, 82, 82, 82, 82, 28, 150, 84, 84, 84, 84];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}


function ensureDashboardSheet_(sheet, settings) {
  if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    writeInitialDashboardSheet_(sheet, settings);
    return;
  }
  if (isGeneratedDashboardSheet_(sheet)) {
    writeInitialDashboardSheet_(sheet, settings);
    return;
  }
  Logger.log("Dashboard already has content; manual layout preserved.");
}


function isGeneratedDashboardSheet_(sheet) {
  try {
    var formulas = [
      sheet.getRange(2, 2).getFormula(),
      sheet.getRange(2, 7).getFormula(),
      sheet.getRange(2, 13).getFormula()
    ].join("\n");
    if (formulas.indexOf("ProductDiagnostics") !== -1) return true;


    var values = [
      sheet.getRange(2, 2).getDisplayValue(),
      sheet.getRange(2, 7).getDisplayValue(),
      sheet.getRange(2, 13).getDisplayValue()
    ].join("\n");
    return values.indexOf("#ERROR!") !== -1 && safeTrim_(sheet.getRange(1, 1).getDisplayValue()) !== "";
  } catch (e) {
    Logger.log("Could not inspect Dashboard: " + ((e && e.message) ? e.message : String(e)));
    return false;
  }
}


function writeInitialDashboardSheet_(sheet, settings) {
  sheet.getRange(1, 1, 42, 18).clearContent();
  sheet.getRange(1, 1, 42, 18).clearFormat();
  sheet.getRange(1, 1, 42, 18).breakApart();
  removeDashboardCharts_(sheet, 42);
  ensureDashboardSheetSize_(sheet, 70, 18);


  var dataSheet = quoteSheetNameForFormula_(settings.dashboardDataSheetName);
  var diagSheet = quoteSheetNameForFormula_(settings.productDiagnosticsSheetName);
  var currencyCode = getAccountCurrencyCode_();
  var currencyFormat = currencyNumberFormat_(currencyCode);


  writeDashboardDataBackedBlock_(sheet, 1, "Товари з конверсіями", [
    ["без продажів", dataSheetFormula_(dataSheet, "B35-B29"), dataSheetFormula_(dataSheet, "C35-C29"), dataSheetFormula_(dataSheet, "D35-D29"), dataSheetFormula_(dataSheet, "E35-E29"), dataSheetFormula_(dataSheet, "F35-F29"), dataSheetFormula_(dataSheet, "G35-G29")],
    ["продажі", dataSheetFormula_(dataSheet, "B29"), dataSheetFormula_(dataSheet, "C29"), dataSheetFormula_(dataSheet, "D29"), dataSheetFormula_(dataSheet, "E29"), dataSheetFormula_(dataSheet, "F29"), dataSheetFormula_(dataSheet, "G29")]
  ]);


  writeDashboardDataBackedBlock_(sheet, 6, "Клікабельні товари", [
    ["високі кліки", dataSheetFormula_(dataSheet, "SUM(B29:B31)"), dataSheetFormula_(dataSheet, "SUM(C29:C31)"), dataSheetFormula_(dataSheet, "SUM(D29:D31)"), dataSheetFormula_(dataSheet, "SUM(E29:E31)"), dataSheetFormula_(dataSheet, "SUM(F29:F31)"), dataSheetFormula_(dataSheet, "SUM(G29:G31)")],
    ["низькі кліки", dataSheetFormula_(dataSheet, "SUM(B32:B34)"), dataSheetFormula_(dataSheet, "SUM(C32:C34)"), dataSheetFormula_(dataSheet, "SUM(D32:D34)"), dataSheetFormula_(dataSheet, "SUM(E32:E34)"), dataSheetFormula_(dataSheet, "SUM(F32:F34)"), dataSheetFormula_(dataSheet, "SUM(G32:G34)")]
  ]);


  writeDashboardDataBackedBlock_(sheet, 11, "Популярні в пошуку", [
    ["високі покази", dataSheetFormula_(dataSheet, "B29+B30+B32"), dataSheetFormula_(dataSheet, "C29+C30+C32"), dataSheetFormula_(dataSheet, "D29+D30+D32"), dataSheetFormula_(dataSheet, "E29+E30+E32"), dataSheetFormula_(dataSheet, "F29+F30+F32"), dataSheetFormula_(dataSheet, "G29+G30+G32")],
    ["низькі покази", dataSheetFormula_(dataSheet, "B31+B33+B34"), dataSheetFormula_(dataSheet, "C31+C33+C34"), dataSheetFormula_(dataSheet, "D31+D33+D34"), dataSheetFormula_(dataSheet, "E31+E33+E34"), dataSheetFormula_(dataSheet, "F31+F33+F34"), dataSheetFormula_(dataSheet, "G31+G33+G34")]
  ]);


  writeDashboardStageSpendSource_(sheet, dataSheet);
  writeDashboardSummaryCard_(sheet, dataSheet);
  writeDashboardQuarantineCard_(sheet, diagSheet, settings);
  writeDashboardSeasonalityCard_(sheet, settings);
  formatDashboardSheet_(sheet, currencyFormat);
  addDashboardCharts_(sheet);
}


function dataSheetFormula_(dataSheet, expression) {
  return "=" + expression.replace(/([A-Z]+[0-9]+(?::[A-Z]+[0-9]+)?)/g, dataSheet + "!$1");
}


function writeDashboardDataBackedBlock_(sheet, startRow, title, rows) {
  var header = [[title, "Кількість товарів", "Покази", "Кліки", "Конверсії", "Цінність конв.", "Витрати"]];
  sheet.getRange(startRow, 1, 1, 7).setValues(header);
  sheet.getRange(startRow + 1, 1, rows.length, 7).setValues(rows);
}
function writeDashboardLegacyBlock_(sheet, startRow, title, segments, diagSheet, segmentCol, impressionsCol, clicksCol, conversionsCol, valueCol, costCol) {
  var header = [[title, "Кількість товарів", "Покази", "Кліки", "Конверсії", "Цінність конв.", "Витрати"]];
  var rows = [];
  for (var i = 0; i < segments.length; i++) {
    var label = segments[i][0];
    var criterion = segments[i][1];
    rows.push([
      label,
      '=COUNTIF(' + diagSheet + '!' + segmentCol + ':' + segmentCol + ',"' + criterion + '")',
      '=SUMIF(' + diagSheet + '!' + segmentCol + ':' + segmentCol + ',"' + criterion + '",' + diagSheet + '!' + impressionsCol + ':' + impressionsCol + ')',
      '=SUMIF(' + diagSheet + '!' + segmentCol + ':' + segmentCol + ',"' + criterion + '",' + diagSheet + '!' + clicksCol + ':' + clicksCol + ')',
      '=SUMIF(' + diagSheet + '!' + segmentCol + ':' + segmentCol + ',"' + criterion + '",' + diagSheet + '!' + conversionsCol + ':' + conversionsCol + ')',
      '=SUMIF(' + diagSheet + '!' + segmentCol + ':' + segmentCol + ',"' + criterion + '",' + diagSheet + '!' + valueCol + ':' + valueCol + ')',
      '=SUMIF(' + diagSheet + '!' + segmentCol + ':' + segmentCol + ',"' + criterion + '",' + diagSheet + '!' + costCol + ':' + costCol + ')'
    ]);
  }
  sheet.getRange(startRow, 1, 1, 7).setValues(header);
  sheet.getRange(startRow + 1, 1, rows.length, 7).setValues(rows);
}


function writeDashboardStageSpendSource_(sheet, dataSheet) {
  sheet.getRange(1, 11, 1, 2).setValues([["Етап", "Витрати"]]);
  var rows = [
    [dataSheetFormula_(dataSheet, "A29"), dataSheetFormula_(dataSheet, "G29")],
    [dataSheetFormula_(dataSheet, "A30"), dataSheetFormula_(dataSheet, "G30")],
    [dataSheetFormula_(dataSheet, "A31"), dataSheetFormula_(dataSheet, "G31")],
    [dataSheetFormula_(dataSheet, "A32"), dataSheetFormula_(dataSheet, "G32")],
    [dataSheetFormula_(dataSheet, "A33"), dataSheetFormula_(dataSheet, "G33")],
    [dataSheetFormula_(dataSheet, "A34"), dataSheetFormula_(dataSheet, "G34")]
  ];
  sheet.getRange(2, 11, rows.length, 2).setValues(rows);
}


function writeDashboardSummaryCard_(sheet, dataSheet) {
  var rows = [
    ["Загалом", ""],
    ["за останні 14 днів", ""],
    ["Товарів", "ROAS"],
    [dataSheetFormula_(dataSheet, 'D11&" шт."'), dataSheetFormula_(dataSheet, "J11")],
    ["", ""],
    ["CPA", "Conversions"],
    [dataSheetFormula_(dataSheet, "H11"), dataSheetFormula_(dataSheet, "G11")],
    ["", ""],
    ["CValue", "Витрати"],
    [dataSheetFormula_(dataSheet, "I11"), dataSheetFormula_(dataSheet, "F11")]
  ];
  sheet.getRange(16, 8, rows.length, 2).setValues(rows);
}


function writeDashboardQuarantineCard_(sheet, diagSheet, settings) {
  var settingsSheet = quoteSheetNameForFormula_(settings.settingsSheetName || SETTINGS_SHEET_NAME);
  var quarantineEnabled = dashboardSettingsBoolFormula_(settingsSheet, "enable_quarantine");
  var noSalesEnabled = dashboardSettingsBoolFormula_(settingsSheet, "enable_no_sales_rule");
  var spendEnabled = dashboardSettingsBoolFormula_(settingsSheet, "enable_spend_rule");
  var expensiveClickEnabled = dashboardSettingsBoolFormula_(settingsSheet, "enable_expensive_click_rule");
  var reasonCol = 'INDEX(' + diagSheet + '!A:ZZ,,MATCH("exclusion_reasons",' + diagSheet + '!1:1,0))';
  var activeCol = 'INDEX(' + diagSheet + '!A:ZZ,,MATCH("quarantine_active",' + diagSheet + '!1:1,0))';
  var activeFormula = '=IF(' + quarantineEnabled + ',COUNTIF(' + activeCol + ',"YES"),0)';
  var noSalesFormula = '=IF(AND(' + quarantineEnabled + ',' + noSalesEnabled + '),COUNTIF(' + reasonCol + ',"*NO_SALES*"),0)';
  var spendFormula = '=IF(AND(' + quarantineEnabled + ',' + spendEnabled + '),COUNTIF(' + reasonCol + ',"*SPEND_OVER_MARGIN*"),0)';
  var clickFormula = '=IF(AND(' + quarantineEnabled + ',' + expensiveClickEnabled + '),COUNTIF(' + reasonCol + ',"*EXPENSIVE_CLICK*"),0)';
  var rows = [
    ["Карантин", "Статус", "Товарів"],
    ["Усього активних", dashboardSettingsStatusFormula_(settingsSheet, "enable_quarantine"), activeFormula],
    ["Кліки без продажів", dashboardSettingsStatusFormula_(settingsSheet, "enable_no_sales_rule"), noSalesFormula],
    ["Витрати > % ціни", dashboardSettingsStatusFormula_(settingsSheet, "enable_spend_rule"), spendFormula],
    ["Дорогий клік", dashboardSettingsStatusFormula_(settingsSheet, "enable_expensive_click_rule"), clickFormula]
  ];
  sheet.getRange(16, 11, rows.length, 3).setValues(rows);
}


function dashboardSettingsBoolFormula_(settingsSheet, key) {
  return 'LOWER(TO_TEXT(IFERROR(VLOOKUP("' + key + '",' + settingsSheet + '!A:B,2,FALSE),"")))="true"';
}


function dashboardSettingsStatusFormula_(settingsSheet, key) {
  return '=IF(' + dashboardSettingsBoolFormula_(settingsSheet, key) + ',"увімкнено","вимкнено")';
}


function writeDashboardSeasonalityCard_(sheet, settings) {
  var seasonalitySheet = quoteSheetNameForFormula_(settings.seasonalitySheetName);
  var rows = [
    ["Сезонність", "Товарів"],
    ["Зима", seasonalityCountFormula_(seasonalitySheet, "winter")],
    ["Весна", seasonalityCountFormula_(seasonalitySheet, "spring")],
    ["Літо", seasonalityCountFormula_(seasonalitySheet, "summer")],
    ["Осінь", seasonalityCountFormula_(seasonalitySheet, "autumn")],
    ["Без сезону", seasonalityWithoutSeasonFormula_(seasonalitySheet)]
  ];
  sheet.getRange(22, 11, 6, 4).clearContent();
  sheet.getRange(22, 11, rows.length, 2).setValues(rows);
}


function seasonalityCountFormula_(seasonalitySheet, headerName) {
  return '=IFERROR(COUNTIF(INDEX(' + seasonalitySheet + '!A:ZZ,,MATCH("' + headerName + '",' + seasonalitySheet + '!1:1,0)),TRUE),0)';
}


function seasonalityWithoutSeasonFormula_(seasonalitySheet) {
  return '=IFERROR(COUNTIFS(INDEX(' + seasonalitySheet + '!A:ZZ,,MATCH("id",' + seasonalitySheet + '!1:1,0)),"<>",INDEX(' + seasonalitySheet + '!A:ZZ,,MATCH("winter",' + seasonalitySheet + '!1:1,0)),FALSE,INDEX(' + seasonalitySheet + '!A:ZZ,,MATCH("spring",' + seasonalitySheet + '!1:1,0)),FALSE,INDEX(' + seasonalitySheet + '!A:ZZ,,MATCH("summer",' + seasonalitySheet + '!1:1,0)),FALSE,INDEX(' + seasonalitySheet + '!A:ZZ,,MATCH("autumn",' + seasonalitySheet + '!1:1,0)),FALSE),0)';
}


function formatDashboardSheet_(sheet, currencyFormat) {
  var blue = "#4a86e8";
  var light = "#c9daf8";


  sheet.setFrozenRows(0);
  sheet.getRange(1, 1, 42, 18).setFontFamily("Arial").setFontSize(10).setWrap(false).setVerticalAlignment("middle");
  sheet.getRange(1, 1, 42, 18).setBackground(null).setFontWeight("normal").setFontColor("#000000");


  formatDashboardLegacyBlock_(sheet, 1, blue, light);
  formatDashboardLegacyBlock_(sheet, 6, blue, light);
  formatDashboardLegacyBlock_(sheet, 11, blue, light);


  sheet.getRange(1, 11, 1, 2).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange(2, 11, 6, 2).setBackground("#ffffff");
  sheet.getRange(1, 11, 7, 2).setFontSize(9);


  sheet.getRange(16, 8, 10, 2).setHorizontalAlignment("center");
  sheet.getRange(16, 8, 1, 2).merge();
  sheet.getRange(17, 8, 1, 2).merge();
  sheet.getRange(16, 8, 1, 2).setBackground(light).setFontWeight("bold");
  sheet.getRange(18, 8, 1, 2).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(21, 8, 1, 2).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(24, 8, 1, 2).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(16, 8, 10, 2).setBorder(true, true, true, true, true, true, blue, SpreadsheetApp.BorderStyle.SOLID);


  sheet.getRange(16, 11, 5, 3).setHorizontalAlignment("center");
  sheet.getRange(16, 11, 1, 2).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(16, 13, 1, 1).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(17, 11, 4, 1).setBackground(light).setFontWeight("bold");
  sheet.getRange(22, 11, 5, 4).setHorizontalAlignment("center");
  sheet.getRange(22, 11, 1, 2).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(22, 14, 1, 1).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(23, 11, 4, 1).setBackground(light).setFontWeight("bold");
  sheet.getRange(22, 11, 5, 4).setBorder(true, true, true, true, true, true, blue, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(16, 11, 5, 3).setBorder(true, true, true, true, true, true, blue, SpreadsheetApp.BorderStyle.SOLID);


  sheet.getRange(2, 6, 12, 2).setNumberFormat(currencyFormat);
  sheet.getRange(22, 8, 1, 1).setNumberFormat(currencyFormat);
  sheet.getRange(25, 8, 1, 2).setNumberFormat(currencyFormat);
  sheet.getRange(19, 9, 1, 1).setNumberFormat("0.00");
  sheet.getRange(2, 5, 12, 1).setNumberFormat("0.##");
  sheet.getRange(22, 9, 1, 1).setNumberFormat("0.##");
  sheet.getRange(17, 13, 4, 1).setNumberFormat("#,##0");


  setDashboardColumnWidths_(sheet);
  setDashboardRowHeights_(sheet);
}


function formatDashboardLegacyBlock_(sheet, startRow, blue, light) {
  sheet.getRange(startRow, 1, 1, 7).setBackground(blue).setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange(startRow, 1).setFontStyle("italic").setFontSize(11);
  sheet.getRange(startRow + 1, 1, 2, 1).setBackground(light).setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange(startRow + 1, 2, 2, 6).setHorizontalAlignment("right");
  sheet.getRange(startRow, 1, 3, 7).setBorder(true, true, true, true, true, true, blue, SpreadsheetApp.BorderStyle.SOLID);
}


function setDashboardColumnWidths_(sheet) {
  var widths = [170, 170, 170, 170, 170, 170, 170, 100, 100, 100, 135, 135, 110, 111, 111, 111, 111, 111];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}


function setDashboardRowHeights_(sheet) {
  for (var i = 1; i <= 45; i++) sheet.setRowHeight(i, 21);
}


function addDashboardCharts_(sheet) {
  var stageChart = sheet.newChart()
    .asBarChart()
    .addRange(sheet.getRange(1, 11, 7, 2))
    .setOption("title", "Витрати на етапи воронки")
    .setOption("legend", { position: "none" })
    .setOption("useFirstColumnAsDomain", true)
    .setOption("width", 296)
    .setOption("height", 172)
    .setPosition(1, 8, 2, 3)
    .build();
  sheet.insertChart(stageChart);


  addDashboardColumnChart_(sheet, 16, 1, "Куди", 2, 1, 2, 0, 2);
  addDashboardColumnChart_(sheet, 16, 3, "ідуть", 7, 1, 2, 2, 2);
  addDashboardColumnChart_(sheet, 16, 5, "гроші?", 12, 1, 2, 3, 2);
  addDashboardPieChart_(sheet, 26, 1, "% Витрат на конверсійні", 2, 1, 7, 0, 1);
  addDashboardPieChart_(sheet, 26, 3, "% Витрат на клікабельні", 7, 1, 7, 2, 1);
  addDashboardPieChart_(sheet, 26, 5, "% Витрат на популярні", 12, 1, 7, 3, 1);
}


function addDashboardColumnChart_(sheet, posRow, posCol, title, dataRow, labelCol, valueCol, offsetX, offsetY) {
  var chart = sheet.newChart()
    .asColumnChart()
    .addRange(sheet.getRange(dataRow, labelCol, 2, 1))
    .addRange(sheet.getRange(dataRow, valueCol, 2, 1))
    .setOption("title", title)
    .setOption("legend", { position: "none" })
    .setOption("width", 330)
    .setOption("height", 210)
    .setPosition(posRow, posCol, offsetX || 0, offsetY || 0)
    .build();
  sheet.insertChart(chart);
}


function addDashboardPieChart_(sheet, posRow, posCol, title, dataRow, labelCol, valueCol, offsetX, offsetY) {
  var chart = sheet.newChart()
    .asPieChart()
    .addRange(sheet.getRange(dataRow, labelCol, 2, 1))
    .addRange(sheet.getRange(dataRow, valueCol, 2, 1))
    .setOption("title", title)
    .setOption("pieHole", 0.45)
    .setOption("width", 330)
    .setOption("height", 220)
    .setPosition(posRow, posCol, offsetX || 0, offsetY || 0)
    .build();
  sheet.insertChart(chart);
}


function logUnifiedSummary_(merchantProducts, productTypeRows, funnelMap, quarantineState, outputRows, settings) {
  Logger.log("Unified summary");
  Logger.log("Merchant products: " + merchantProducts.length);
  Logger.log("ProductTypes rows: " + productTypeRows.length);
  Logger.log("Funnel stats products: " + Object.keys(funnelMap).length);
  Logger.log("Quarantine active products: " + Object.keys(quarantineState.activeById || {}).length);
  Logger.log("Products rows written: " + outputRows.length);
  Logger.log("Product type filter enabled: " + settings.enableProductTypeFilter);
  Logger.log("Funnel Builder enabled: " + settings.enableFunnelBuilder);
  Logger.log("Quarantine enabled: " + settings.enableQuarantine);
}


/* ================= Shared helpers ================= */


function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}


function ensureSpreadsheetLocale_(ss) {
  try {
    if (ss.getSpreadsheetLocale && ss.getSpreadsheetLocale() === DEFAULT_SPREADSHEET_LOCALE) return;
    if (ss.setSpreadsheetLocale) {
      ss.setSpreadsheetLocale(DEFAULT_SPREADSHEET_LOCALE);
      Logger.log("Spreadsheet locale set to " + DEFAULT_SPREADSHEET_LOCALE + " for generated formulas.");
    }
  } catch (e) {
    Logger.log("Could not set spreadsheet locale: " + ((e && e.message) ? e.message : String(e)));
  }
}


function ensureSheetIsFirst_(ss, sheet) {
  if (ss.getSheets()[0].getSheetId() === sheet.getSheetId()) return;
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
  Logger.log("Лист '" + sheet.getName() + "' перенесено на першу позицію.");
}


function ensureCoreSheetOrder_(ss, productsSheet, dashboardSheet, dashboardDataSheet) {
  var orderedSheets = [productsSheet, dashboardSheet, dashboardDataSheet];
  for (var i = 0; i < orderedSheets.length; i++) {
    var sheet = orderedSheets[i];
    try {
      sheet.showSheet();
    } catch (e) {
      Logger.log("Лист '" + sheet.getName() + "' не вдалося показати: " + ((e && e.message) ? e.message : String(e)));
    }
    if (ss.getSheets()[i] && ss.getSheets()[i].getSheetId() === sheet.getSheetId()) continue;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  }
}


function hideDefaultBlankSheets_(ss, managedSheets) {
  var managedIds = {};
  for (var key in managedSheets) {
    if (managedSheets.hasOwnProperty(key) && managedSheets[key]) managedIds[managedSheets[key].getSheetId()] = true;
  }
  var defaultNames = {
    "лист1": true,
    "sheet1": true,
    "аркуш1": true
  };
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (managedIds[sheet.getSheetId()]) continue;
    if (!defaultNames[safeTrim_(sheet.getName()).toLowerCase()]) continue;
    if (sheet.getLastRow() > 0 || sheet.getLastColumn() > 0) continue;
    try {
      sheet.hideSheet();
      Logger.log("Порожній стандартний лист '" + sheet.getName() + "' приховано.");
    } catch (e) {
      Logger.log("Не вдалося приховати лист '" + sheet.getName() + "': " + ((e && e.message) ? e.message : String(e)));
    }
  }
}


function protectManagedSheets_(ss, settings) {
  var openSheetNames = {};
  openSheetNames[settings.productTypesSheetName] = true;
  openSheetNames[settings.dashboardSheetName] = true;
  openSheetNames[settings.dashboardDataSheetName] = true;
  openSheetNames[settings.settingsSheetName || SETTINGS_SHEET_NAME] = true;
  var ownerEmail = getProtectionOwnerEmail_();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (openSheetNames[sheet.getName()]) {
      removeUnifiedSheetProtections_(sheet);
      continue;
    }
    ensureUnifiedSheetProtection_(sheet, ownerEmail);
  }
}


function ensureUnifiedSheetProtection_(sheet, ownerEmail) {
  var description = "Unified Product Control: службовий лист";
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var protection = null;
  for (var i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === description) {
      protection = protections[i];
    }
  }
  if (!protection) protection = sheet.protect().setDescription(description);
  try {
    protection.setWarningOnly(false);
    if (ownerEmail) protection.addEditor(ownerEmail);
    var editors = protection.getEditors();
    var remove = [];
    for (var e = 0; e < editors.length; e++) {
      if (!ownerEmail || editors[e].getEmail() !== ownerEmail) remove.push(editors[e]);
    }
    if (remove.length) protection.removeEditors(remove);
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  } catch (err) {
    Logger.log("Не вдалося оновити захист листа '" + sheet.getName() + "': " + ((err && err.message) ? err.message : String(err)));
  }
}


function removeUnifiedSheetProtections_(sheet) {
  var description = "Unified Product Control: службовий лист";
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (var i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === description) protections[i].remove();
  }
}


function getProtectionOwnerEmail_() {
  try {
    var user = Session.getEffectiveUser();
    return user && user.getEmail ? safeTrim_(user.getEmail()) : "";
  } catch (e) {
    return "";
  }
}


function removeDashboardCharts_(sheet, maxAnchorRow) {
  var charts = sheet.getCharts();
  for (var i = 0; i < charts.length; i++) {
    var anchorRow = charts[i].getContainerInfo().getAnchorRow();
    if (!maxAnchorRow || anchorRow <= maxAnchorRow) sheet.removeChart(charts[i]);
  }
}


function columnLetter_(index) {
  var letters = "";
  var n = Math.max(1, Number(index) || 1);
  while (n > 0) {
    var mod = (n - 1) % 26;
    letters = String.fromCharCode(65 + mod) + letters;
    n = Math.floor((n - mod) / 26);
  }
  return letters;
}


function ensureHeaderRow_(sheet, header) {
  var values = sheet.getDataRange().getValues();
  if (values.length === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    return;
  }


  var current = values[0] || [];
  var same = current.length >= header.length;
  for (var i = 0; i < header.length; i++) {
    if (current[i] !== header[i]) {
      same = false;
      break;
    }
  }
  if (!same) sheet.getRange(1, 1, 1, header.length).setValues([header]);
}


function normalizeProductType_(value) {
  return safeTrim_(value)
    .replace(/\u00A0/g, " ")
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s*\u2192\s*/g, " > ")
    .replace(/(зима|весна|літо|лето|осінь|осень)\s*>\s*(зима|весна|літо|лето|осінь|осень)/gi, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}


function buildProductTypeSearchText_(productTypes) {
  if (!productTypes || !productTypes.length) return "";
  var seen = {};
  var out = [];
  for (var i = 0; i < productTypes.length; i++) {
    var normalized = normalizeProductType_(productTypes[i]);
    if (!normalized || seen[normalized]) continue;
    seen[normalized] = true;
    out.push(normalized);
  }
  return out.join(" || ");
}


function splitProductType_(productTypeRaw, maxLevels) {
  var result = createEmptyPath_(maxLevels);
  var normalized = normalizeProductType_(productTypeRaw);
  if (!normalized) return result;
  // Only ">" is a hierarchy delimiter. "/" stays inside names like "осінь/весна".
  var parts = normalized.split(/\s*>\s*/);
  for (var i = 0; i < maxLevels && i < parts.length; i++) result[i] = safeTrim_(parts[i]);
  return normalizePathToFilledLevels_(result, maxLevels);
}


function normalizePathToFilledLevels_(path, maxLevels) {
  var result = [];
  var foundEmpty = false;
  for (var i = 0; i < maxLevels; i++) {
    var value = safeTrim_(path[i]);
    if (!value || foundEmpty) {
      foundEmpty = true;
      result.push("");
    } else {
      result.push(value);
    }
  }
  return result;
}


function applySparsePathRow_(currentPath, row, startIndex, maxLevels) {
  for (var level = 0; level < maxLevels; level++) {
    var value = safeTrim_(row[startIndex + level]);
    if (value !== "") {
      currentPath[level] = value;
      for (var resetLevel = level + 1; resetLevel < maxLevels; resetLevel++) currentPath[resetLevel] = "";
    }
  }
}


function makeSparseDisplayPath_(path, maxLevels) {
  var result = createEmptyPath_(maxLevels);
  var depth = getPathDepth_(path, maxLevels);
  if (depth > 0) result[depth - 1] = path[depth - 1];
  return result;
}


function buildPathKey_(path, maxLevels) {
  var parts = [];
  for (var i = 0; i < maxLevels; i++) {
    var value = safeTrim_(path[i]);
    if (!value) break;
    parts.push(value);
  }
  return parts.join("|||");
}


function getPathDepth_(path, maxLevels) {
  var depth = 0;
  for (var i = 0; i < maxLevels; i++) {
    if (safeTrim_(path[i]) !== "") depth++;
    else break;
  }
  return depth;
}


function createEmptyPath_(maxLevels) {
  var path = [];
  for (var i = 0; i < maxLevels; i++) path.push("");
  return path;
}


function matchesListFilter_(value, filter) {
  var tokens = parseFilterTokens_(filter);
  if (tokens.length === 0) return true;
  var normalizedValue = safeTrim_(value).toLowerCase();
  for (var i = 0; i < tokens.length; i++) {
    if (normalizedValue === tokens[i]) return true;
  }
  return false;
}


function matchesDataSourceFilter_(dataSource, filter) {
  var tokens = parseFilterTokens_(filter);
  if (tokens.length === 0) return true;
  var normalizedValue = safeTrim_(dataSource).toLowerCase();
  var lastSegment = getDataSourceId_(normalizedValue);
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    if (normalizedValue === token) return true;
    if (lastSegment === token) return true;
  }
  return false;
}


function getDataSourceId_(dataSource) {
  var value = safeTrim_(dataSource);
  var slashIndex = value.lastIndexOf("/");
  return slashIndex >= 0 ? value.substring(slashIndex + 1) : value;
}


function toMerchantApiCustomLabelField_(value) {
  var v = safeTrim_(value);
  var m = v.match(/^custom_label_([0-4])$/i);
  if (m) return "customLabel" + m[1];
  m = v.match(/^customLabel([0-4])$/);
  if (m) return "customLabel" + m[1];
  return "";
}


function isValidFeedCustomLabelHeader_(value) {
  return /^custom_label_[0-4]$/i.test(safeTrim_(value));
}


function parseFilterTokens_(filter) {
  var raw = safeTrim_(filter);
  if (!raw) return [];
  var parts = raw.split(",");
  var tokens = [];
  for (var i = 0; i < parts.length; i++) {
    var token = safeTrim_(parts[i]).toLowerCase();
    if (token) tokens.push(token);
  }
  return tokens;
}


function getDateRange_(nDays, excludeLastDays) {
  var today = getDateOnly_(new Date());
  var excluded = Math.abs(Number(excludeLastDays || 0));
  var days = Math.max(1, Math.abs(Number(nDays || 0)));
  var end = addDays_(today, -excluded);
  var start = addDays_(end, -(days - 1));
  return { start: formatApiDate_(start), end: formatApiDate_(end) };
}


function addDays_(d, days) {
  var nd = new Date(d.getTime());
  nd.setDate(nd.getDate() + days);
  return getDateOnly_(nd);
}


function getDateOnly_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}


function formatDate_(d) {
  return Utilities.formatDate(d, AdsApp.currentAccount().getTimeZone(), DATE_FORMAT);
}


function formatApiDate_(d) {
  return Utilities.formatDate(d, AdsApp.currentAccount().getTimeZone(), API_DATE_FORMAT);
}


function getAccountCurrencyCode_() {
  try {
    var currencyCode = AdsApp.currentAccount().getCurrencyCode();
    return safeTrim_(currencyCode) || "UAH";
  } catch (e) {
    Logger.log("Не вдалося прочитати currency code акаунта: " + ((e && e.message) ? e.message : String(e)));
    return "UAH";
  }
}


function currencyNumberFormat_(currencyCode) {
  var code = safeTrim_(currencyCode).replace(/"/g, "");
  return code ? '"' + code + '" #,##0.00' : "#,##0.00";
}


function yyyymmdd_(s) {
  return String(s).replace(/-/g, "");
}


function parseDateFlexible_(val) {
  if (Object.prototype.toString.call(val) === "[object Date]" && !isNaN(val)) return getDateOnly_(val);
  var s = safeTrim_(val);
  if (!s) return null;


  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return getDateOnly_(new Date(+m[1], +m[2] - 1, +m[3]));


  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return getDateOnly_(new Date(+m[3], +m[2] - 1, +m[1]));


  var d = new Date(s);
  if (!isNaN(d)) return getDateOnly_(d);
  return null;
}


function isDateActive_(dateValue, today) {
  var d = parseDateFlexible_(dateValue);
  if (!d) return false;
  return d.getTime() > today.getTime();
}


function maxDateStr_(a, b) {
  var da = parseDateFlexible_(a);
  var db = parseDateFlexible_(b);
  if (da && db) return da.getTime() >= db.getTime() ? formatDate_(da) : formatDate_(db);
  if (da) return formatDate_(da);
  if (db) return formatDate_(db);
  return "";
}


function maxDateStr3_(a, b, c) {
  return maxDateStr_(maxDateStr_(a, b), c);
}


function normOfferId_(s) {
  return normalizeId_(s).toLowerCase();
}


function normalizeId_(s) {
  if (s == null) return "";
  var x = String(s);
  x = x.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
  x = x.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  x = x.replace(/\u00A0/g, " ");
  x = x.replace(/[ \t]{2,}/g, " ");
  return x.trim();
}


function naturalCmp_(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}


function safeTrim_(value) {
  return value == null ? "" : String(value).trim();
}


function findHeaderIndex_(header, name) {
  var wanted = safeTrim_(name).toLowerCase();
  for (var i = 0; i < header.length; i++) {
    if (safeTrim_(header[i]).toLowerCase() === wanted) return i;
  }
  return -1;
}


function round2_(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}


function formatPercent2_(value) {
  return round2_((Number(value) || 0) * 100).toFixed(2) + "%";
}


function formatCurrencyText_(value, currencyCode) {
  var code = safeTrim_(currencyCode).replace(/"/g, "") || "UAH";
  return code + " " + round2_(value).toFixed(2);
}


function toNumber_(value) {
  if (value == null || value === "") return 0;
  var n = Number(String(value).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}
