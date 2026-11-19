// Curated inputs for the README gallery, in Chinese and English.
// Every number describes a fictional coffee chain; none comes from a real business.
// The regression suite keeps its own adversarial inputs in skills/html-view/kchart/tests/kchart-cases.mjs.

const pick = lang => (zh, en) => (lang === 'en' ? en : zh);

export function galleryCases(lang) {
  const L = pick(lang);
  const months = L(['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月'], ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']);
  const cities = {
    sh: L('上海', 'Shanghai'), hz: L('杭州', 'Hangzhou'), cd: L('成都', 'Chengdu'),
    sz: L('深圳', 'Shenzhen'), bj: L('北京', 'Beijing'), wh: L('武汉', 'Wuhan'),
  };
  const drinks = {
    latte: L('拿铁', 'Latte'), americano: L('美式', 'Americano'), oat: L('燕麦拿铁', 'Oat latte'),
    cold: L('冷萃', 'Cold brew'), tea: L('茶饮', 'Tea'), pour: L('手冲', 'Pour-over'),
  };
  const cups = L('杯', 'cups');
  const minutes = L('分钟', 'min');
  const byMonth = (fields, count = 8) => months.slice(0, count).map((month, i) => ({ month, ...Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, values[i]])) }));
  const series = (...pairs) => Object.fromEntries(pairs.map(([key, label]) => [key, { label }]));

  // A bell-shaped density sampled inside ±3σ, so violins taper instead of ending in flat caps.
  const density = (mean, sigma) => {
    const from = Math.max(0, Math.ceil((mean - 3 * sigma) * 4) / 4), to = Math.floor((mean + 3 * sigma) * 4) / 4;
    return Array.from({ length: Math.round((to - from) * 4) + 1 }, (_, k) => {
      const value = from + k / 4;
      return [value, Number(Math.exp(-((value - mean) ** 2) / (2 * sigma ** 2)).toFixed(3))];
    });
  };

  const storeTree = { id: 'open', label: L('新店开业', 'New store'), children: [
    { id: 'site', label: L('选址', 'Site'), children: [{ id: 'traffic', label: L('客流', 'Traffic') }, { id: 'rent', label: L('租金', 'Rent') }] },
    { id: 'fit', label: L('筹备', 'Prep'), children: [{ id: 'build', label: L('装修', 'Build') }, { id: 'hire', label: L('招聘', 'Hiring') }] },
    { id: 'launch', label: L('开业', 'Launch'), children: [{ id: 'soft', label: L('试营业', 'Soft open') }, { id: 'promo', label: L('会员活动', 'Promo') }] },
  ] };

  const charts = {
    line: {
      chart: 'line', title: L('日均出杯在 6 月越过目标', 'Daily cups passed the target in June'),
      data: byMonth({ cups: [820, 760, 910, 980, 1060, 1180, 1240, 1310] }),
      encode: { category: 'month', value: 'cups' }, unit: cups, fields: { cups: { label: L('日均出杯', 'Daily cups') } },
      annotations: [{ kind: 'rule', field: 'cups', value: 1200, label: L('目标', 'Target') }],
    },
    area: {
      chart: 'area', title: L('三个渠道的日均出杯', 'Daily cups by channel'), stack: 'absolute',
      data: byMonth({ store: [520, 480, 560, 590, 620, 660, 680, 700], delivery: [190, 180, 220, 240, 270, 320, 340, 360], app: [110, 100, 130, 150, 170, 200, 220, 250] }),
      encode: { category: 'month', value: ['store', 'delivery', 'app'] },
      fields: series(['store', L('门店', 'In-store')], ['delivery', L('外卖', 'Delivery')], ['app', L('小程序', 'App')]), unit: cups,
    },
    sparkline: {
      chart: 'sparkline', title: L('近 12 周会员复购', 'Member repeat orders, last 12 weeks'),
      data: [312, 298, 334, 351, 340, 366, 389, 375, 402, 418, 409, 436].map((orders, i) => ({ week: L(`第${i + 1}周`, `W${i + 1}`), orders })),
      encode: { category: 'week', value: 'orders' }, unit: L('单', 'orders'),
    },
    'small-multiples': {
      chart: 'small-multiples', title: L('四座城市各自的走势', 'Each city on its own scale'),
      data: Object.entries({ sh: [1520, 1480, 1610, 1690, 1750, 1880, 1920, 1990], hz: [980, 940, 1010, 1090, 1150, 1210, 1260, 1300], cd: [720, 700, 760, 820, 880, 950, 1010, 1060], sz: [860, 820, 870, 900, 940, 990, 1020, 1080] })
        .flatMap(([city, values]) => byMonth({ cups: values }, 6).map(row => ({ ...row, city: cities[city] }))),
      encode: { category: 'month', value: 'cups', panel: 'city' }, unit: cups,
    },
    stream: {
      chart: 'stream', title: L('入夏后冷萃迅速放量', 'Cold brew took off in summer'),
      data: byMonth({ latte: [310, 300, 330, 340, 350, 360, 370, 380], americano: [220, 210, 230, 240, 260, 300, 320, 330], cold: [40, 40, 60, 90, 140, 210, 260, 290], tea: [90, 100, 110, 120, 130, 150, 160, 170] }),
      encode: { category: 'month', value: ['latte', 'americano', 'cold', 'tea'] },
      fields: series(['latte', drinks.latte], ['americano', drinks.americano], ['cold', drinks.cold], ['tea', drinks.tea]), unit: cups,
    },
    'split-compare': {
      chart: 'split-compare', title: L('新会员与流失会员', 'New and lapsed members'),
      data: byMonth({ joined: [620, 540, 780, 860, 940, 1120, 1080, 1160], lapsed: [210, 260, 240, 220, 250, 270, 300, 280] }),
      encode: { category: 'month', upper: 'joined', lower: 'lapsed' },
      fields: { joined: { label: L('新会员', 'New'), unit: L('人', 'members') }, lapsed: { label: L('流失', 'Lapsed'), unit: L('人', 'members') } },
    },
    combo: {
      chart: 'combo', title: L('营收与毛利率', 'Revenue and margin'),
      data: byMonth({ revenue: [612, 548, 671, 702, 748, 812, 845, 880].map(k => k * 1000), margin: [0.18, 0.16, 0.19, 0.21, 0.22, 0.24, 0.25, 0.24] }),
      encode: { category: 'month' }, layers: [{ mark: 'column', field: 'revenue', axis: 'left' }, { mark: 'line', field: 'margin', axis: 'right' }],
      fields: { revenue: { label: L('营收', 'Revenue'), unit: L('元', 'CNY') }, margin: { label: L('毛利率', 'Margin'), format: 'percent' } },
    },
    bump: {
      chart: 'bump', title: L('燕麦拿铁与冷萃先后登顶', 'Oat latte, then cold brew, took the lead'),
      data: months.slice(0, 6).flatMap((month, j) => Object.entries({
        latte: [1, 1, 1, 2, 2, 3], americano: [2, 2, 3, 3, 4, 4], oat: [3, 3, 2, 1, 1, 2], tea: [4, 4, 4, 5, 5, 5], cold: [5, 5, 5, 4, 3, 1],
      }).map(([drink, ranks]) => ({ month, drink: drinks[drink], rank: ranks[j] }))),
      encode: { category: 'month', series: 'drink', rank: 'rank' },
    },
    candlestick: {
      chart: 'candlestick', title: L('生豆周价格', 'Weekly green-coffee price'),
      data: [[70, 72, 69, 74], [72, 71, 69, 73], [71, 75, 70, 76], [75, 78, 74, 80], [78, 76, 74, 79], [76, 73, 72, 77], [73, 74, 71, 76], [74, 77, 73, 78]]
        .map(([open, close, low, high], i) => ({ week: L(`第${i + 1}周`, `W${i + 1}`), open, close, low, high })),
      encode: { category: 'week', open: 'open', close: 'close', low: 'low', high: 'high' }, unit: L('元/千克', 'CNY/kg'),
    },
    'launch-fan': {
      chart: 'launch-fan', title: L('新店从开业到现在', 'New stores, from opening day to now'),
      data: [['2025-03', L('西湖店', 'West Lake'), 640], ['2025-06', L('静安店', "Jing'an"), 820], ['2025-09', L('春熙店', 'Chunxi'), 560], ['2025-12', L('南山店', 'Nanshan'), 480], ['2026-02', L('三里屯店', 'Sanlitun'), 390], ['2026-04', L('光谷店', 'Optics Valley'), 260]]
        .map(([opened, store, cupsToday]) => ({ store, opened, cupsToday })),
      encode: { label: 'store', start: 'opened', value: 'cupsToday' }, fields: { opened: { type: 'month' } }, unit: cups,
    },

    bar: {
      chart: 'bar', title: L('上海门店最多', 'Shanghai has the most stores'),
      data: [['sh', 18], ['hz', 12], ['cd', 10], ['sz', 9], ['bj', 8], ['wh', 5]].map(([city, stores]) => ({ city: cities[city], stores })),
      encode: { category: 'city', value: 'stores' }, unit: L('家', 'stores'),
    },
    column: {
      chart: 'column', title: L('每月新增会员', 'New members each month'),
      data: byMonth({ members: [620, 540, 780, 860, 940, 1120] }, 6),
      encode: { category: 'month', value: 'members' }, unit: L('人', 'members'),
    },
    dumbbell: {
      chart: 'dumbbell', title: L('换用制作屏后等待更短', 'Waits fell after the new order screen'),
      data: [['sh', 6.8, 4.1], ['hz', 5.9, 3.8], ['cd', 7.2, 4.6], ['sz', 6.1, 4.4], ['bj', 7.5, 5.2]].map(([city, before, after]) => ({ city: cities[city], before, after })),
      encode: { category: 'city', before: 'before', after: 'after' }, unit: minutes,
      fields: { before: { label: L('换屏前', 'Before') }, after: { label: L('换屏后', 'After') } },
    },
    slope: {
      chart: 'slope', title: L('推荐值：一年前后', 'Net promoter score, a year apart'),
      data: [['sh', 42, 51], ['hz', 38, 47], ['cd', 45, 41], ['sz', 33, 44], ['bj', 36, 39]].map(([city, before, after]) => ({ city: cities[city], before, after })),
      encode: { category: 'city', before: 'before', after: 'after' }, unit: L('分', 'pts'),
      fields: { before: { label: '2025' }, after: { label: '2026' } },
    },
    bullet: {
      chart: 'bullet', title: L('8 月出杯与目标', 'August cups against target'),
      data: [['sh', 48, 45], ['hz', 31, 34], ['cd', 27, 25], ['sz', 24, 28], ['bj', 22, 20]].map(([city, actual, target]) => ({ city: cities[city], actual: actual * 1000, target: target * 1000 })),
      encode: { category: 'city', actual: 'actual', target: 'target' }, unit: cups,
    },
    gauge: {
      chart: 'gauge', title: L('年度营收目标完成度', 'Annual revenue goal'), range: [0, 1],
      data: [{ done: 0.68, elapsed: 0.67 }], encode: { value: 'done', target: 'elapsed' },
      fields: { done: { label: L('已完成', 'Done'), format: 'percent' }, elapsed: { label: L('时间进度', 'Year elapsed'), format: 'percent' } },
    },
    interval: {
      chart: 'interval', title: L('外卖送达时间', 'Delivery time'),
      data: [['sh', 18, 26, 34], ['hz', 16, 23, 31], ['cd', 20, 28, 39], ['sz', 15, 21, 29], ['bj', 22, 30, 41]].map(([city, low, median, high]) => ({ city: cities[city], low, median, high })),
      encode: { category: 'city', low: 'low', high: 'high', value: 'median' }, unit: minutes,
    },

    share: {
      chart: 'share', title: L('订单渠道', 'Orders by channel'),
      data: [[L('门店', 'In-store'), 46], [L('外卖', 'Delivery'), 29], [L('小程序自提', 'App pickup'), 19], [L('企业团购', 'Corporate'), 6]].map(([channel, orders]) => ({ channel, orders: orders * 1000 })),
      encode: { category: 'channel', value: 'orders' }, unit: L('单', 'orders'), fields: { orders: { label: L('订单', 'Orders') } },
    },
    pie: {
      chart: 'pie', title: L('营收构成', 'Revenue mix'),
      data: [[L('咖啡', 'Coffee'), 62], [L('烘焙', 'Bakery'), 16], [L('茶饮', 'Tea'), 14], [L('周边', 'Merch'), 8]].map(([kind, revenue]) => ({ kind, revenue: revenue * 10000 })),
      encode: { category: 'kind', value: 'revenue' }, unit: L('元', 'CNY'),
    },
    donut: {
      chart: 'donut', title: L('支付方式', 'Payment methods'),
      data: [[L('微信支付', 'WeChat Pay'), 58], [L('支付宝', 'Alipay'), 27], [L('会员余额', 'Member balance'), 11], [L('其他', 'Other'), 4]].map(([method, orders]) => ({ method, orders: orders * 1000 })),
      encode: { category: 'method', value: 'orders' }, unit: L('单', 'orders'),
    },
    'radial-share': {
      chart: 'radial-share', title: L('渠道份额与满意度', 'Channel share and satisfaction'),
      data: [[L('门店', 'In-store'), 46, 4.7], [L('外卖', 'Delivery'), 29, 4.1], [L('自提', 'Pickup'), 19, 4.5], [L('团购', 'Corporate'), 6, 4.3]].map(([channel, orders, score]) => ({ channel, orders: orders * 1000, score })),
      encode: { category: 'channel', value: 'orders', intensity: 'score' },
      fields: { orders: { label: L('订单', 'Orders'), unit: L('单', 'orders') }, score: { label: L('满意度', 'Satisfaction'), unit: L('分', 'pts') } },
    },
    rose: {
      chart: 'rose', title: L('各时段订单', 'Orders by time of day'),
      data: [[L('早晨', 'Early'), 34], [L('上午', 'Morning'), 21], [L('午间', 'Lunch'), 18], [L('下午', 'Afternoon'), 15], [L('傍晚', 'Evening'), 8], [L('夜间', 'Night'), 4]].map(([slot, orders]) => ({ slot, orders: orders * 1000 })),
      encode: { category: 'slot', value: 'orders' }, unit: L('单', 'orders'),
    },
    funnel: {
      chart: 'funnel', title: L('小程序下单漏斗', 'App ordering funnel'),
      data: [[L('打开小程序', 'Opened app'), 10000], [L('浏览菜单', 'Viewed menu'), 7400], [L('加入购物车', 'Added to cart'), 4100], [L('提交订单', 'Checked out'), 2900], [L('完成支付', 'Paid'), 2650]].map(([step, users]) => ({ step, users })),
      encode: { category: 'step', value: 'users' }, unit: L('人', 'users'),
    },
    waterfall: {
      chart: 'waterfall', title: L('一杯 32 元的拿铁，钱去了哪里', 'Where the price of a latte goes'), start: 32,
      data: [[L('原料', 'Ingredients'), -8], [L('人工', 'Staff'), -6], [L('租金', 'Rent'), -6], [L('平台佣金', 'Platform fee'), -4], [L('损耗', 'Waste'), -2]].map(([item, delta]) => ({ item, delta })),
      encode: { category: 'item', delta: 'delta' }, unit: L('元', 'CNY'),
    },
    waffle: {
      chart: 'waffle', title: L('杯型构成', 'Cup sizes'),
      data: [[L('中杯', 'Medium'), 46], [L('大杯', 'Large'), 38], [L('超大杯', 'Extra large'), 16]].map(([size, orders]) => ({ size, orders })),
      encode: { category: 'size', value: 'orders' },
    },
    tally: {
      chart: 'tally', title: L('顾客希望增加的选项（可多选）', 'What guests asked for (multiple choice)'),
      data: [[L('燕麦奶', 'Oat milk'), 0.42], [L('少糖', 'Less sugar'), 0.36], [L('自带杯优惠', 'Own-cup discount'), 0.28], [L('晚间营业', 'Late hours'), 0.17]].map(([option, rate]) => ({ option, rate })),
      encode: { category: 'option', value: 'rate' }, fields: { rate: { format: 'percent' } },
    },

    histogram: {
      chart: 'histogram', title: L('出杯等待时间', 'Wait for a drink'),
      data: [[0, 2, 100], [2, 4, 350], [4, 6, 400], [6, 8, 250], [8, 10, 100], [10, 12, 50]].map(([lower, upper, count]) => ({ lower, upper, count })),
      encode: { lower: 'lower', upper: 'upper', count: 'count' },
      fields: { lower: { label: L('等待时间', 'Wait'), unit: minutes }, upper: { label: L('等待时间', 'Wait'), unit: minutes }, count: { label: L('订单数', 'Orders'), unit: L('单', 'orders') } },
    },
    boxplot: {
      chart: 'boxplot', title: L('各时段等待时间', 'Wait time by time of day'),
      data: [[L('早高峰', 'Morning rush'), 2.1, 4.0, 5.2, 6.8, 9.5, [12.4]], [L('午间', 'Lunch'), 1.6, 3.1, 4.0, 5.2, 7.4, [10.1]], [L('下午', 'Afternoon'), 1.0, 2.0, 2.8, 3.6, 5.1, []], [L('晚间', 'Evening'), 0.8, 1.6, 2.2, 3.0, 4.2, [6.3]]]
        .map(([slot, low, q1, median, q3, high, outliers]) => ({ slot, low, q1, median, q3, high, outliers })),
      encode: { category: 'slot', low: 'low', q1: 'q1', median: 'median', q3: 'q3', high: 'high', outliers: 'outliers' }, unit: minutes,
    },
    violin: {
      chart: 'violin', title: L('三类门店的出杯时长', 'Brew time by store format'),
      data: [[L('街边店', 'Street'), 3, 0.8], [L('商场店', 'Mall'), 4, 1], [L('写字楼', 'Office'), 5.5, 1.3]].map(([format, mean, sigma]) => ({ format, curve: density(mean, sigma), median: mean })),
      encode: { category: 'format', density: 'curve', median: 'median' }, unit: minutes,
    },
    strip: {
      chart: 'strip', title: L('每家门店的日均出杯', 'Daily cups, one dot per store'),
      data: Object.entries({ sh: [620, 710, 540, 880, 760, 690, 930, 580], hz: [480, 560, 640, 520, 590, 450, 610], cd: [420, 510, 470, 560, 390, 530], sz: [500, 610, 470, 560, 680] })
        .flatMap(([city, values]) => values.map((value, i) => ({ city: cities[city], store: `${city}-${i + 1}`, value }))),
      encode: { category: 'city', value: 'value', id: 'store' }, unit: cups,
    },
    scatter: {
      chart: 'scatter', title: L('客流越大，出杯越多', 'More foot traffic, more cups'),
      data: [['西湖', 'West Lake', 3200, 640, 'street'], ['静安', "Jing'an", 4100, 820, 'mall'], ['春熙', 'Chunxi', 2900, 560, 'mall'], ['南山', 'Nanshan', 2500, 480, 'office'], ['三里屯', 'Sanlitun', 2300, 390, 'street'], ['光谷', 'Optics', 1500, 260, 'office'], ['滨江', 'Binjiang', 2000, 430, 'office'], ['徐汇', 'Xuhui', 3600, 700, 'street'], ['福田', 'Futian', 3000, 520, 'mall'], ['望京', 'Wangjing', 2700, 470, 'office']]
        .map(([zh, en, traffic, cupsPerDay, format], i) => ({ id: `store-${i + 1}`, store: L(zh, en), traffic, cupsPerDay, format: { street: L('街边店', 'Street'), mall: L('商场店', 'Mall'), office: L('写字楼', 'Office') }[format] })),
      encode: { x: 'traffic', y: 'cupsPerDay', series: 'format', label: 'store', id: 'id' },
      fields: { traffic: { label: L('日客流', 'Daily foot traffic'), unit: L('人', 'people') }, cupsPerDay: { label: L('日均出杯', 'Cups per day'), unit: cups } },
    },

    heatmap: {
      chart: 'heatmap', title: L('一周里的订单高峰', 'When orders peak during the week'),
      data: L(['周一', '周二', '周三', '周四', '周五', '周六', '周日'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).flatMap((day, i) =>
        L(['7点', '9点', '11点', '13点', '15点', '17点'], ['7am', '9am', '11am', '1pm', '3pm', '5pm']).map((slot, j) => ({ day, slot,
          orders: i < 5 ? [92, 78, 40, 54, 36, 28][j] + ((i * 7 + j * 3) % 9) : [18, 46, 70, 82, 74, 52][j] + ((i + j * 5) % 7) }))),
      encode: { row: 'day', column: 'slot', value: 'orders' },
      fields: { orders: { label: L('订单', 'Orders'), unit: L('单', 'orders'), domain: [0, 120] } },
    },
    'bubble-matrix': {
      chart: 'bubble-matrix', title: L('城市与渠道的订单量', 'Orders by city and channel'),
      data: Object.entries({ sh: [46, 31, 22], hz: [30, 18, 15], cd: [24, 20, 9], sz: [19, 22, 14] }).flatMap(([city, values]) =>
        [L('门店', 'In-store'), L('外卖', 'Delivery'), L('自提', 'Pickup')].map((channel, j) => ({ city: cities[city], channel, orders: values[j] * 1000 }))),
      encode: { row: 'city', column: 'channel', value: 'orders' },
      fields: { city: { label: L('城市', 'City') }, channel: { label: L('渠道', 'Channel') }, orders: { label: L('订单', 'Orders'), unit: L('单', 'orders') } },
    },
    radar: {
      chart: 'radar', title: L('三款招牌的风味', 'Flavor of three signatures'),
      data: [[drinks.latte, 3, 2, 4, 3, 2], [drinks.americano, 1, 4, 3, 4, 3], [drinks.cold, 2, 3, 3, 5, 4]].map(([drink, sweet, acid, body, aroma, finish]) => ({ drink, sweet, acid, body, aroma, finish })),
      encode: { label: 'drink', dimensions: ['sweet', 'acid', 'body', 'aroma', 'finish'] },
      fields: Object.fromEntries([['sweet', L('甜感', 'Sweet')], ['acid', L('酸度', 'Acidity')], ['body', L('醇厚', 'Body')], ['aroma', L('香气', 'Aroma')], ['finish', L('余韵', 'Finish')]].map(([key, label]) => [key, { label, domain: [0, 5] }])),
    },
    parallel: {
      chart: 'parallel', title: L('六家门店的四项指标', 'Six stores on four measures'),
      data: [['西湖', 'West Lake', 640, 31, 0.46, 3.8], ['静安', "Jing'an", 820, 34, 0.52, 4.6], ['春熙', 'Chunxi', 560, 28, 0.41, 3.2], ['南山', 'Nanshan', 480, 33, 0.38, 2.9], ['三里屯', 'Sanlitun', 390, 36, 0.35, 3.5], ['光谷', 'Optics', 260, 30, 0.29, 3.1]]
        .map(([zh, en, daily, ticket, repeat, wait], i) => ({ id: `p${i + 1}`, store: L(zh, en), daily, ticket, repeat, wait })),
      encode: { label: 'store', dimensions: ['daily', 'ticket', 'repeat', 'wait'], id: 'id' },
      fields: { daily: { label: L('日均出杯', 'Cups/day'), unit: cups }, ticket: { label: L('客单价', 'Ticket'), unit: L('元', 'CNY') }, repeat: { label: L('复购率', 'Repeat'), format: 'percent' }, wait: { label: L('等待', 'Wait'), unit: minutes } },
    },
    calendar: {
      chart: 'calendar', title: L('上半年每天的出杯量', 'Cups served each day, first half'), period: '2026',
      data: Array.from({ length: 181 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 0, 1 + i)), weekend = [0, 6].includes(date.getUTCDay());
        const closed = date.getUTCMonth() === 1 && date.getUTCDate() >= 16 && date.getUTCDate() <= 18;
        return { date: date.toISOString().slice(0, 10), cups: closed ? 0 : 240 + Math.round(i * 4.2) + (weekend ? 320 : 0) + ((i * 37) % 120) };
      }),
      encode: { date: 'date', value: 'cups' }, unit: cups,
    },

    tree: { chart: 'tree', title: L('新店开业的分工', 'Opening a new store'), layout: 'right', data: storeTree },
    mindmap: { chart: 'mindmap', title: L('新店开业', 'Opening a new store'), layout: 'bilateral', data: storeTree },
    treemap: {
      // Values are whole CNY; KChart writes them as 万 in Chinese and K/M in English.
      chart: 'treemap', title: L('各区域营收', 'Revenue by region'), unit: L('元', 'CNY'),
      data: { label: L('全国', 'All regions'), children: [
        { label: L('华东', 'East'), children: [{ label: cities.sh, value: 460 }, { label: cities.hz, value: 280 }, { label: L('南京', 'Nanjing'), value: 120 }] },
        { label: L('西南', 'Southwest'), children: [{ label: cities.cd, value: 220 }, { label: L('重庆', 'Chongqing'), value: 140 }] },
        { label: L('华南', 'South'), children: [{ label: cities.sz, value: 190 }, { label: L('广州', 'Guangzhou'), value: 150 }] },
      ].map(region => ({ ...region, children: region.children.map(city => ({ ...city, value: city.value * 10000 })) })) },
    },
    network: {
      chart: 'network', title: L('常被一起买的单品', 'Items bought together'), layout: 'circular',
      data: {
        nodes: [['latte', drinks.latte, 'drink'], ['americano', drinks.americano, 'drink'], ['cold', drinks.cold, 'drink'], ['croissant', L('可颂', 'Croissant'), 'food'], ['bagel', L('贝果', 'Bagel'), 'food'], ['cake', L('芝士蛋糕', 'Cheesecake'), 'food']]
          .map(([id, label, group]) => ({ id, label, group: group === 'drink' ? L('饮品', 'Drinks') : L('烘焙', 'Bakery') })),
        edges: [['latte', 'croissant', 42], ['latte', 'cake', 30], ['americano', 'bagel', 36], ['americano', 'croissant', 18], ['cold', 'cake', 22], ['cold', 'bagel', 12], ['latte', 'americano', 8]]
          .map(([source, target, value], i) => ({ id: `e${i + 1}`, source, target, value })),
      },
    },
    sankey: {
      chart: 'sankey', title: L('从渠道到饮品与温度', 'From channel to drink and temperature'), layout: 'right', unit: cups,
      data: {
        nodes: [['store', L('门店', 'In-store')], ['delivery', L('外卖', 'Delivery')], ['app', L('小程序', 'App')], ['coffee', L('咖啡', 'Coffee')], ['tea', L('茶饮', 'Tea')], ['hot', L('热饮', 'Hot')], ['iced', L('冰饮', 'Iced')]].map(([id, label]) => ({ id, label })),
        edges: [['store', 'coffee', 420], ['store', 'tea', 80], ['delivery', 'coffee', 210], ['delivery', 'tea', 110], ['app', 'coffee', 160], ['app', 'tea', 40], ['coffee', 'hot', 430], ['coffee', 'iced', 360], ['tea', 'hot', 60], ['tea', 'iced', 170]]
          .map(([source, target, value]) => ({ source, target, value })),
      },
    },
    threads: {
      chart: 'threads', title: L('首单之后 30 天', 'Thirty days after the first order'), layout: 'right', unit: L('人', 'guests'),
      data: {
        stages: [['entry', L('入口', 'Entry')], ['first', L('首单', 'First order')], ['day30', L('30 天后', 'Day 30')]].map(([id, label]) => ({ id, label })),
        nodes: [['qr', L('门店扫码', 'Store QR'), 'entry'], ['platform', L('外卖平台', 'Delivery app'), 'entry'], ['latte', drinks.latte, 'first'], ['cold', drinks.cold, 'first'], ['back', L('回购', 'Returned'), 'day30'], ['gone', L('流失', 'Lapsed'), 'day30']]
          .map(([id, label, stage]) => ({ id, label, stage })),
        paths: [[['qr', 'latte', 'back'], 9], [['qr', 'cold', 'back'], 6], [['platform', 'latte', 'gone'], 5], [['platform', 'cold', 'back'], 4], [['qr', 'latte', 'gone'], 3]]
          .map(([nodes, value], i) => ({ id: `t${i + 1}`, nodes, value })),
      },
    },
    choropleth: {
      chart: 'choropleth', title: L('咖啡豆网店的美国订单', 'Online bean orders in the US'), unit: L('单', 'orders'),
      data: { map: { asset: 'us-states' }, rows: [['US-CA', 240], ['US-WA', 180], ['US-OR', 120], ['US-NY', 210], ['US-MA', 90], ['US-TX', 150], ['US-IL', 110], ['US-CO', 80], ['US-FL', 130], ['US-GA', 60]].map(([region, value]) => ({ region, value })) },
      encode: { region: 'region', value: 'value' },
    },
    'geo-scatter': {
      chart: 'geo-scatter', title: L('生豆产地与采购量', 'Where the green coffee comes from'), unit: L('吨', 'tonnes'),
      fields: { value: { label: L('采购量', 'Purchases') } },
      data: { map: { asset: 'world' }, rows: [[38.7, 6.8, L('埃塞俄比亚', 'Ethiopia'), 42], [-75.5, 4.8, L('哥伦比亚', 'Colombia'), 36], [-45.0, -21.0, L('巴西', 'Brazil'), 58], [37.0, -0.5, L('肯尼亚', 'Kenya'), 18], [100.2, 23.0, L('云南', 'Yunnan'), 27], [98.7, 2.9, L('苏门答腊', 'Sumatra'), 15]]
        .map(([longitude, latitude, label, value]) => ({ longitude, latitude, label, value })) },
      encode: { longitude: 'longitude', latitude: 'latitude', label: 'label', value: 'value' },
    },
  };
  // sunburst reads the same tree as treemap.
  charts.sunburst = { ...charts.treemap, chart: 'sunburst', title: L('各区域营收（环形）', 'Revenue by region, as rings') };

  // Variant inputs reuse the base chart; only unit-mark variants need to say what one mark stands for.
  const unitMarks = {
    'bar:rungs': { value: 2, label: L('家', 'stores') },
    'bar:pictorial': { value: 2, label: L('家', 'stores'), icon: 'building-store' },
    'column:rungs': { value: 200, label: L('人', 'members') },
    'column:pictorial': { value: 200, label: L('人', 'members'), icon: 'user' },
    'dumbbell:rungs': { value: 1, label: minutes },
    'waterfall:rungs': { value: 2, label: L('元', 'CNY') },
    'histogram:rungs': { value: 50, label: L('单', 'orders') },
  };
  const variantSpec = (chart, variant) => {
    const spec = { ...charts[chart], variant };
    const unitMark = unitMarks[`${chart}:${variant}`];
    if (unitMark) spec.unitMark = unitMark;
    return spec;
  };

  // Mermaid and native structure diagrams. Code identifiers stay in English in both languages.
  const diagrams = {
    flowchart: ['mermaid', L(
      'flowchart LR\n  order[下单] --> stock{原料够吗}\n  stock -->|够| make[制作]\n  stock -->|不够| swap[推荐替代]\n  swap --> order\n  make --> pickup([取餐])',
      'flowchart LR\n  order[Order] --> stock{In stock?}\n  stock -->|yes| make[Make drink]\n  stock -->|no| swap[Suggest a swap]\n  swap --> order\n  make --> pickup([Pick up])')],
    'stateDiagram-v2': ['mermaid', L(
      'stateDiagram-v2\n  state "待支付" as unpaid\n  state "制作中" as making\n  state "待取餐" as ready\n  state "已完成" as done\n  state "已取消" as cancelled\n  [*] --> unpaid\n  unpaid --> making: 支付成功\n  unpaid --> cancelled: 超时\n  making --> ready: 出杯\n  ready --> done: 取餐\n  done --> [*]\n  cancelled --> [*]',
      'stateDiagram-v2\n  state "Awaiting payment" as unpaid\n  state "Brewing" as making\n  state "Ready" as ready\n  state "Collected" as done\n  state "Cancelled" as cancelled\n  [*] --> unpaid\n  unpaid --> making: paid\n  unpaid --> cancelled: timed out\n  making --> ready: served\n  ready --> done: picked up\n  done --> [*]\n  cancelled --> [*]')],
    journey: ['mermaid', L(
      'journey\n  section 到店\n    排队点单: 3: 顾客\n    等待出杯: 2: 顾客, 咖啡师\n    找座位: 4: 顾客\n  section 回访\n    小程序复购: 5: 顾客',
      'journey\n  section Visit\n    Queue and order: 3: Guest\n    Wait for the drink: 2: Guest, Barista\n    Find a seat: 4: Guest\n  section Return\n    Reorder in the app: 5: Guest')],
    swimlane: ['swimlane', L(
      'swimlane LR\nlane 顾客\n  a[小程序下单]\n  f[到店取餐]\nlane 门店\n  b[接单]\n  d[出杯]\n  c{外送吗}\nlane 骑手\n  e[配送]\na --> b\nb --> d\nd --> c\nc -->|否| f\nc -->|是| e',
      'swimlane LR\nlane Guest\n  a[App order]\n  f[Pick up]\nlane Store\n  b[Accept]\n  d[Serve]\n  c{Deliver?}\nlane Courier\n  e[Deliver]\na --> b\nb --> d\nd --> c\nc -->|no| f\nc -->|yes| e')],
    sequenceDiagram: ['mermaid', L(
      'sequenceDiagram\n  participant App as 小程序\n  participant API as 订单服务\n  participant Pay as 支付平台\n  participant Bar as 制作屏\n  App->>API: 提交订单\n  API->>Pay: 发起扣款\n  Pay-->>API: 支付成功\n  API->>Bar: 推送制作单\n  API-->>App: 返回取餐码',
      'sequenceDiagram\n  participant App as App\n  participant API as Order API\n  participant Pay as Payments\n  participant Bar as Bar screen\n  App->>API: Place order\n  API->>Pay: Charge card\n  Pay-->>API: Paid\n  API->>Bar: Send ticket\n  API-->>App: Pickup code')],
    zenuml: ['mermaid', L(
      'zenuml\n  App\n  OrderAPI\n  App->OrderAPI: 查询进度\n  OrderAPI.estimateWait()',
      'zenuml\n  App\n  OrderAPI\n  App->OrderAPI: check status\n  OrderAPI.estimateWait()')],
    erDiagram: ['mermaid', L(
      'erDiagram\n  CUSTOMER ||--o{ ORDER : 下单\n  ORDER ||--|{ ORDER_ITEM : 包含\n  PRODUCT ||--o{ ORDER_ITEM : 售出\n  CUSTOMER {\n    string id PK\n    string nickname\n  }\n  ORDER {\n    string id PK\n    string status\n  }\n  ORDER_ITEM {\n    int quantity\n  }\n  PRODUCT {\n    string name\n    int price\n  }',
      'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ ORDER_ITEM : contains\n  PRODUCT ||--o{ ORDER_ITEM : "sold as"\n  CUSTOMER {\n    string id PK\n    string nickname\n  }\n  ORDER {\n    string id PK\n    string status\n  }\n  ORDER_ITEM {\n    int quantity\n  }\n  PRODUCT {\n    string name\n    int price\n  }')],
    classDiagram: ['mermaid', L(
      'classDiagram\n  class Order {\n    +id: string\n    +status: OrderStatus\n    +total(): Money\n  }\n  class OrderItem {\n    +size: CupSize\n    +quantity: int\n  }\n  class Drink {\n    +name: string\n  }\n  Order "1" *-- "1..*" OrderItem : 包含\n  OrderItem "*" --> "1" Drink : 指向',
      'classDiagram\n  class Order {\n    +id: string\n    +status: OrderStatus\n    +total(): Money\n  }\n  class OrderItem {\n    +size: CupSize\n    +quantity: int\n  }\n  class Drink {\n    +name: string\n  }\n  Order "1" *-- "1..*" OrderItem : contains\n  OrderItem "*" --> "1" Drink : refers to')],
    requirementDiagram: ['mermaid', L(
      'requirementDiagram\n  performanceRequirement peak {\n    id: REQ-12\n    text: 高峰期 3 分钟内出杯\n    risk: medium\n    verifymethod: test\n  }\n  element BarScreen {\n    docref: 制作屏 v2\n  }\n  BarScreen - satisfies -> peak',
      'requirementDiagram\n  performanceRequirement peak {\n    id: REQ-12\n    text: Serve within 3 minutes at peak\n    risk: medium\n    verifymethod: test\n  }\n  element BarScreen {\n    docref: Bar screen v2\n  }\n  BarScreen - satisfies -> peak')],
    gantt: ['mermaid', L(
      'gantt\n  dateFormat YYYY-MM-DD\n  section 筹备\n  选址签约 :done, site, 2026-03-02, 2026-03-20\n  装修施工 :active, build, 2026-03-16, 2026-04-24\n  section 开业\n  员工培训 :crit, train, 2026-04-13, 2026-05-01\n  试营业 :milestone, soft, 2026-05-06, 0d\n  会员活动 :promo, 2026-05-08, 2026-05-22',
      'gantt\n  dateFormat YYYY-MM-DD\n  section Prepare\n  Sign the lease :done, site, 2026-03-02, 2026-03-20\n  Build-out :active, build, 2026-03-16, 2026-04-24\n  section Open\n  Staff training :crit, train, 2026-04-13, 2026-05-01\n  Soft launch :milestone, soft, 2026-05-06, 0d\n  Member offer :promo, 2026-05-08, 2026-05-22')],
    timeline: ['mermaid', L(
      'timeline\n  section 起步\n    2019 : 第一家店 : 只做手冲\n    2021 : 上线小程序\n  section 扩张\n    2026 : 门店达到 62 家 : 进入成都和深圳',
      'timeline\n  section Early days\n    2019 : First store : Pour-over only\n    2021 : Ordering app\n  section Growth\n    2026 : 62 stores : Now in Chengdu and Shenzhen')],
    gitGraph: ['mermaid', 'gitGraph\n  commit id: "v2.3"\n  branch summer-menu\n  checkout summer-menu\n  commit id: "cold-brew"\n  commit id: "oat-latte"\n  checkout main\n  commit id: "fix-refund"\n  merge summer-menu id: "v2.4"'],
    kanban: ['mermaid', L(
      'kanban\ntodo[待评估]\n  oat[燕麦拿铁减糖版]\n  lid[可回收杯盖]\ndoing[试做中]\n  osmanthus[桂花冷萃]\ndone[已上架]\n  yunnan[云南手冲]',
      'kanban\ntodo[To review]\n  oat[Less-sugar oat latte]\n  lid[Recyclable lids]\ndoing[In testing]\n  osmanthus[Osmanthus cold brew]\ndone[On the menu]\n  yunnan[Yunnan pour-over]')],
    'packet-beta': ['mermaid', L(
      'packet-beta\n  0-3: "版本"\n  4-7: "类型"\n  8-23: "门店编号"\n  24-31: "队列序号"\n  32-47: "取餐码"\n  48-63: "校验和"',
      'packet-beta\n  0-3: "Version"\n  4-7: "Type"\n  8-23: "Store ID"\n  24-31: "Queue no."\n  32-47: "Pickup code"\n  48-63: "Checksum"')],
    quadrantChart: ['mermaid', L(
      'quadrantChart\n  x-axis 低毛利 --> 高毛利\n  y-axis 低销量 --> 高销量\n  quadrant-1 明星\n  quadrant-2 引流款\n  quadrant-3 待淘汰\n  quadrant-4 潜力款\n  拿铁: 0.62, 0.86\n  美式: 0.78, 0.66\n  桂花冷萃: 0.84, 0.30\n  热可可: 0.24, 0.20\n  柠檬茶: 0.33, 0.62',
      'quadrantChart\n  x-axis Low margin --> High margin\n  y-axis Low volume --> High volume\n  quadrant-1 Stars\n  quadrant-2 Crowd-pleasers\n  quadrant-3 Retire\n  quadrant-4 Hidden gems\n  Latte: 0.62, 0.86\n  Americano: 0.78, 0.66\n  Osmanthus: 0.84, 0.30\n  Hot cocoa: 0.24, 0.20\n  Lemon tea: 0.33, 0.62')],
    C4Context: ['mermaid', L(
      'C4Context\n  Person(guest, "顾客", "用小程序点单")\n  System(order, "点单系统", "下单、支付与取餐")\n  System_Ext(pay, "支付平台")\n  Rel(guest, order, "下单")\n  Rel(order, pay, "扣款")',
      'C4Context\n  Person(guest, "Guest", "Orders in the app")\n  System(order, "Ordering", "Orders, payment, pickup")\n  System_Ext(pay, "Payments")\n  Rel(guest, order, "orders")\n  Rel(order, pay, "charges")')],
    C4Container: ['mermaid', L(
      'C4Container\n  System_Boundary(sys, "点单系统") {\n    Container(app, "小程序", "微信")\n    Container(api, "订单服务", "Node.js")\n    ContainerDb(db, "订单库", "PostgreSQL")\n  }\n  Rel(app, api, "HTTPS")\n  Rel(api, db, "读写")',
      'C4Container\n  System_Boundary(sys, "Ordering") {\n    Container(app, "App", "WeChat")\n    Container(api, "Order API", "Node.js")\n    ContainerDb(db, "Orders", "PostgreSQL")\n  }\n  Rel(app, api, "HTTPS")\n  Rel(api, db, "reads, writes")')],
    C4Component: ['mermaid', L(
      'C4Component\n  System_Boundary(api, "订单服务") {\n    Component(ctrl, "下单接口", "REST")\n    Component(price, "计价", "会员价与优惠")\n    Component(stock, "库存检查", "门店原料")\n  }\n  Rel(ctrl, price, "计算")\n  Rel(ctrl, stock, "校验")',
      'C4Component\n  System_Boundary(api, "Order API") {\n    Component(ctrl, "Checkout", "REST")\n    Component(price, "Pricing", "Member prices, offers")\n    Component(stock, "Stock check", "Store ingredients")\n  }\n  Rel(ctrl, price, "prices")\n  Rel(ctrl, stock, "checks")')],
    C4Dynamic: ['mermaid', L(
      'C4Dynamic\n  Person(guest, "顾客")\n  System(order, "点单系统")\n  System(bar, "制作屏")\n  Rel(guest, order, "提交订单")\n  Rel(order, bar, "推送制作单")',
      'C4Dynamic\n  Person(guest, "Guest")\n  System(order, "Ordering")\n  System(bar, "Bar screen")\n  Rel(guest, order, "places order")\n  Rel(order, bar, "sends ticket")')],
    C4Deployment: ['mermaid', L(
      'C4Deployment\n  Deployment_Node(cloud, "华东云区域", "Kubernetes") {\n    Container(api, "订单服务", "Node.js")\n  }\n  Deployment_Node(shop, "门店", "平板") {\n    Container(bar, "制作屏", "Web")\n  }\n  Rel(api, bar, "WebSocket")',
      'C4Deployment\n  Deployment_Node(cloud, "Cloud region", "Kubernetes") {\n    Container(api, "Order API", "Node.js")\n  }\n  Deployment_Node(shop, "Store", "Tablet") {\n    Container(bar, "Bar screen", "Web")\n  }\n  Rel(api, bar, "WebSocket")')],
    'architecture-beta': ['mermaid', L(
      'architecture-beta\n  group cloud(cloud)[云端]\n  service api(server)[订单服务] in cloud\n  service db(database)[订单库] in cloud\n  service app(browser)[小程序]\n  app:R --> L:api\n  api:R --> L:db',
      'architecture-beta\n  group cloud(cloud)[Cloud]\n  service api(server)[Order API] in cloud\n  service db(database)[Orders] in cloud\n  service app(browser)[App]\n  app:R --> L:api\n  api:R --> L:db')],
    'block-beta': ['mermaid', L(
      'block-beta\n  columns 3\n  app["小程序"]\n  api["订单服务"]\n  db["订单库"]\n  app --> api\n  api --> db',
      'block-beta\n  columns 3\n  app["App"]\n  api["Order API"]\n  db["Orders"]\n  app --> api\n  api --> db')],
    pie: ['mermaid', L('pie\n  "门店" : 46\n  "外卖" : 31\n  "小程序自提" : 23', 'pie\n  "In-store" : 46\n  "Delivery" : 31\n  "App pickup" : 23')],
    'xychart-beta': ['mermaid', L(
      'xychart-beta\n  x-axis [周一, 周二, 周三, 周四, 周五, 周六, 周日]\n  y-axis "杯" 0 --> 1600\n  bar [980, 1020, 1060, 1100, 1240, 1480, 1390]',
      'xychart-beta\n  x-axis [Mon, Tue, Wed, Thu, Fri, Sat, Sun]\n  y-axis "Cups" 0 --> 1600\n  bar [980, 1020, 1060, 1100, 1240, 1480, 1390]')],
    'sankey-beta': ['mermaid', L(
      'sankey-beta\n门店,拿铁,420\n门店,美式,260\n外卖,拿铁,240\n外卖,冷萃,180\n小程序,美式,150\n小程序,冷萃,120',
      'sankey-beta\nIn-store,Latte,420\nIn-store,Americano,260\nDelivery,Latte,240\nDelivery,Cold brew,180\nApp,Americano,150\nApp,Cold brew,120')],
    'radar-beta': ['mermaid', L(
      'radar-beta\n  axis 酸度, 醇厚, 甜感, 香气, 余韵\n  max 5\n  curve 埃塞俄比亚{5, 2, 4, 5, 3}\n  curve 巴西{2, 5, 3, 3, 4}',
      'radar-beta\n  axis Acidity, Body, Sweet, Aroma, Finish\n  max 5\n  curve Ethiopia{5, 2, 4, 5, 3}\n  curve Brazil{2, 5, 3, 3, 4}')],
    'treemap-beta': ['mermaid', L(
      'treemap-beta\n"单杯成本"\n  "原料"\n    "咖啡豆" : 4.2\n    "牛奶" : 2.6\n    "杯具" : 1.1\n  "人工" : 3.4\n  "租金" : 2.8',
      'treemap-beta\n"Cost per cup"\n  "Ingredients"\n    "Beans" : 4.2\n    "Milk" : 2.6\n    "Cup and lid" : 1.1\n  "Staff" : 3.4\n  "Rent" : 2.8')],
    mindmap: ['mermaid', L(
      'mindmap\n  root((新店开业))\n    选址\n      客流\n      租金\n    筹备\n      装修\n      招聘\n    开业\n      试营业\n      会员活动',
      'mindmap\n  root((New store))\n    Site\n      Traffic\n      Rent\n    Prep\n      Build\n      Hiring\n    Launch\n      Soft open\n      Promo')],
    layers: ['layers', L(
      'layers\n- 触达\n  - 渠道: 小程序, 外卖平台, 门店收银\n- 交易\n  - 订单: 下单, 支付, 退款\n  - 会员: 积分, 优惠券\n- 履约\n  - 门店: 制作屏, 叫号\n  - 配送: 骑手调度',
      'layers\n- Reach\n  - Channels: App, Delivery apps, Till\n- Transactions\n  - Orders: Checkout, Payment, Refunds\n  - Members: Points, Coupons\n- Fulfilment\n  - Store: Bar screen, Pickup calls\n  - Delivery: Courier dispatch')],
    blocks: ['blocks', L(
      'blocks\ncol\n  row\n    box 小程序\n      点单, 会员码\n    box 订单服务\n      计价, 库存\n  row\n    box 支付平台 {ext}\n      扣款, 退款\n    box 订单库 {db}\n      订单, 流水\n小程序 -> 订单服务: 下单\n订单服务 -> 订单库: 写入\n小程序 ~> 支付平台: 扣款',
      'blocks\ncol\n  row\n    box App\n      Ordering, Member code\n    box Order API\n      Pricing, Stock\n  row\n    box Payments {ext}\n      Charges, Refunds\n    box Orders {db}\n      Orders, Ledger\nApp -> Order API: orders\nOrder API -> Orders: writes\nApp ~> Payments: pays')],
  };

  const cards = (prefix, items) => items.map(([id, zh, en, wide]) => ({ id: `${prefix}${id}`, title: L(zh, en), wide }));
  const chartCards = items => cards('chart-', items);
  const diagramCards = items => cards('diagram-', items);
  const groups = [
    { id: 'trends', kind: 'chart', title: L('趋势与时间', 'Trends over time'), items: chartCards([
      ['line', '走势', 'Line'], ['area', '堆叠面积', 'Stacked area'], ['sparkline', '迷你走势', 'Sparkline'], ['small-multiples', '小多图', 'Small multiples'],
      ['stream', '流图', 'Streamgraph'], ['split-compare', '上下对照', 'Mirrored comparison'], ['combo', '双轴组合', 'Dual-axis combo', true], ['bump', '排名变动', 'Rank changes'],
      ['candlestick', '开收与高低', 'Open, close, high, low'], ['launch-fan', '从开张到现在', 'From launch to now', true],
    ]) },
    { id: 'comparison', kind: 'chart', title: L('比较、目标与区间', 'Comparisons, targets and ranges'), items: chartCards([
      ['bar', '横向比较', 'Bars'], ['column', '纵向比较', 'Columns'], ['dumbbell', '前后差距', 'Before and after'], ['slope', '变化方向', 'Slope'],
      ['bullet', '实际与目标', 'Actual vs target'], ['gauge', '完成度', 'Progress'], ['interval', '区间与中位数', 'Range and median'],
    ]) },
    { id: 'composition', kind: 'chart', title: L('构成与增减', 'Parts of a whole and change'), items: chartCards([
      ['share', '占比条', 'Share bar'], ['pie', '饼图', 'Pie'], ['donut', '环形图', 'Donut'], ['radial-share', '份额与强度', 'Share and intensity'], ['rose', '玫瑰图', 'Rose'],
      ['funnel', '漏斗', 'Funnel'], ['waterfall', '瀑布', 'Waterfall'], ['waffle', '百格图', 'Waffle'], ['tally', '多选比例', 'Multiple-choice shares'],
    ]) },
    { id: 'distribution', kind: 'chart', title: L('分布与相关', 'Distributions and correlation'), items: chartCards([
      ['histogram', '直方图', 'Histogram'], ['boxplot', '箱线图', 'Box plot'], ['violin', '小提琴图', 'Violin'], ['strip', '散点条', 'Strip plot'], ['scatter', '散点图', 'Scatter'],
    ]) },
    { id: 'matrix', kind: 'chart', title: L('矩阵与多维', 'Matrices and many measures'), items: chartCards([
      ['heatmap', '热力图', 'Heatmap'], ['bubble-matrix', '气泡矩阵', 'Bubble matrix'], ['radar', '雷达图', 'Radar'], ['parallel', '平行坐标', 'Parallel coordinates', true], ['calendar', '日历', 'Calendar', true],
    ]) },
    { id: 'hierarchy', kind: 'chart', title: L('层级', 'Hierarchies'), items: chartCards([
      ['tree', '层级树', 'Tree'], ['mindmap', '脑图', 'Mind map'], ['treemap', '矩形树图', 'Treemap'], ['sunburst', '旭日图', 'Sunburst'],
    ]) },
    { id: 'relations', kind: 'chart', title: L('网络、流量与路径', 'Networks, flows and paths'), items: chartCards([
      ['network', '关系网络', 'Network'], ['sankey', '桑基图', 'Sankey', true], ['threads', '路径流向', 'Path threads', true],
    ]) },
    { id: 'geography', kind: 'chart', title: L('地图', 'Maps'), items: chartCards([
      ['choropleth', '分区着色', 'Choropleth', true], ['geo-scatter', '地图散点', 'Points on a map', true],
    ]) },
    { id: 'process', kind: 'diagram', title: L('流程、状态与旅程', 'Flows, states and journeys'), items: diagramCards([
      ['flowchart', '流程图', 'Flowchart'], ['stateDiagram-v2', '状态图', 'State diagram'], ['journey', '体验旅程', 'Customer journey'], ['swimlane', '泳道图', 'Swimlanes', true],
    ]) },
    { id: 'model', kind: 'diagram', title: L('时序与数据模型', 'Sequences and data models'), items: diagramCards([
      ['sequenceDiagram', '时序图', 'Sequence'], ['zenuml', 'ZenUML', 'ZenUML'], ['erDiagram', 'ER 图', 'ER diagram'], ['classDiagram', '类图', 'Class diagram'], ['requirementDiagram', '需求图', 'Requirements'],
    ]) },
    { id: 'planning', kind: 'diagram', title: L('排期、看板与协议', 'Plans, boards and protocols'), items: diagramCards([
      ['gantt', '甘特图', 'Gantt', true], ['timeline', '时间线', 'Timeline', true], ['gitGraph', 'Git 分支', 'Git graph'], ['kanban', '看板', 'Kanban', true],
      ['packet-beta', '报文位域', 'Packet layout'], ['quadrantChart', '四象限', 'Quadrant chart'],
    ]) },
    { id: 'architecture', kind: 'diagram', title: L('架构与分层', 'Architecture'), items: diagramCards([
      ['layers', '分层图', 'Layers'], ['blocks', '能力块', 'Blocks', true], ['architecture-beta', '架构图', 'Architecture'], ['block-beta', '块图', 'Block diagram'],
    ]) },
    { id: 'c4', kind: 'diagram', title: L('C4 的五个视角', 'Five C4 views'), items: diagramCards([
      ['C4Context', '系统上下文', 'Context'], ['C4Container', '容器', 'Containers'], ['C4Component', '组件', 'Components'], ['C4Dynamic', '动态', 'Dynamic'], ['C4Deployment', '部署', 'Deployment'],
    ]) },
    { id: 'mermaid-data', kind: 'diagram', title: L('Mermaid 数值图', 'Mermaid charts'), items: diagramCards([
      ['pie', '饼图', 'Pie'], ['xychart-beta', 'XY 图', 'XY chart'], ['sankey-beta', '桑基图', 'Sankey'], ['radar-beta', '雷达图', 'Radar'], ['treemap-beta', '矩形树图', 'Treemap'],
    ]) },
    { id: 'mindmaps', kind: 'diagram', title: L('一棵树，八种脑图布局', 'One tree, eight mind-map layouts'), items: [
      ...diagramCards([['mindmap', 'Mermaid 脑图', 'Mermaid mind map']]),
      ...cards('mindmap-', [['bilateral', '双侧', 'Bilateral'], ['right', '向右', 'Right'], ['left', '向左', 'Left'], ['radial', '放射', 'Radial'], ['org', '组织', 'Org chart'],
        ['brace', '括号', 'Brace'], ['fishbone', '鱼骨', 'Fishbone', true], ['timeline', '时间线', 'Timeline', true]]),
    ] },
  ];
  const variantGroups = [
    { id: 'variants-marks', kind: 'variant', title: L('柱、线与标记', 'Bars, lines and marks'), charts: ['bar', 'column', 'line'] },
    { id: 'variants-part', kind: 'variant', title: L('占比与阶段', 'Shares and stages'), charts: ['share', 'donut', 'funnel', 'waffle'] },
    { id: 'variants-value', kind: 'variant', title: L('目标、差距与分布', 'Targets, gaps and distributions'), charts: ['gauge', 'dumbbell', 'waterfall', 'histogram', 'scatter'] },
    { id: 'variants-pattern', kind: 'variant', title: L('矩阵、日历与网络', 'Matrices, calendars and networks'), charts: ['heatmap', 'calendar', 'network', 'mindmap'] },
  ];
  const variantLabel = {
    solid: L('实心', 'Solid'), rungs: L('单位刻度', 'Unit rungs'), pictorial: L('图标', 'Pictogram'), lollipop: L('棒棒糖', 'Lollipop'),
    counter: L('末值突出', 'Latest value'), barcode: L('条码', 'Barcode'), ticks: L('刻度', 'Ticks'), bars: L('横条', 'Bars'),
    hourglass: L('沙漏', 'Hourglass'), bar: L('条形', 'Bar'), arc: L('圆弧', 'Arc'), dots: L('点阵', 'Dots'), plumb: L('垂线', 'Drop lines'),
    cells: L('方格', 'Cells'), field: L('疏朗点阵', 'Open field'), lines: L('连线', 'Lines'), membrane: L('弦膜', 'Membrane'),
    editorial: L('编辑式', 'Editorial'), cards: L('卡片式', 'Cards'),
  };
  // The theme section shows one chart in every built-in theme.
  const themeSpec = {
    chart: 'column', title: L('三个月的订单', 'Orders over three months'),
    data: [[L('8月', 'Aug'), 18, 11], [L('9月', 'Sep'), 22, 16], [L('10月', 'Oct'), 19, 27]].map(([month, store, online]) => ({ month, store: store * 1000, online: online * 1000 })),
    encode: { category: 'month', value: ['store', 'online'] }, fields: series(['store', L('门店', 'In-store')], ['online', L('线上', 'Online')]), unit: L('单', 'orders'),
  };
  const words = {
    sections: { chart: L('数据图', 'Data charts'), diagram: L('结构图', 'Diagrams'), variant: L('受控变体', 'Variants') },
    themes: L('同一张图，不同主题', 'One chart, different themes'),
    scheme: { light: L('亮色', 'light'), dark: L('暗色', 'dark') },
    layout: id => `mindmap / ${id}`,
  };
  return { charts, diagrams, storeTree, groups, variantGroups, variantLabel, variantSpec, themeSpec, words };
}
