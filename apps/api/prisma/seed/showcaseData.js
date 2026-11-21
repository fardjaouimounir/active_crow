// Static, entirely fictional content of the demo agency «ActiCrew Démo»: people, brands, shops and
// texts. Names are common Algerian given and family names; brands and shops are invented. Nothing
// here refers to a real person, company or product. Offsets are days relative to the run day.

export const AGENCY = { code: 'ACTICREW-DEMO', name: 'ActiCrew Démo' };
export const EMAIL_DOMAIN = 'demo.acticrew.test';

// wilayaId → [regional manager key, supervisor key]
export const WILAYA_PLAN = {
  16: ['centre', 'S1'], // Alger
  9: ['centre', 'S1'], // Blida
  42: ['centre', 'S1'], // Tipaza
  19: ['centre', 'S2'], // Sétif (Hauts-Plateaux)
  25: ['centre', 'S2'], // Constantine
  7: ['centre', 'S4'], // Biskra (south)
  47: ['centre', 'S4'], // Ghardaïa (south)
  31: ['ouest', 'S3'], // Oran
  13: ['ouest', 'S3'], // Tlemcen
};

export const REGIONS = [
  { key: 'centre', code: 'DEMO-CENTRE', name: 'Centre', wilayas: [16, 9, 42, 19, 25, 7, 47] },
  { key: 'ouest', code: 'DEMO-OUEST', name: 'Ouest', wilayas: [31, 13] },
];

export const STAFF = {
  director: { email: 'director', name: 'Karim Belkacem', role: 'director' },
  general: { email: 'gm', name: 'سعيد بوزيد', role: 'general_manager', wilayaId: 16 },
  centre: {
    email: 'regional.centre',
    name: 'Farid Mebarki',
    role: 'regional_manager',
    wilayaId: 16,
  },
  ouest: { email: 'regional.ouest', name: 'نادية سعدي', role: 'regional_manager', wilayaId: 31 },
  S1: { email: 'supervisor1', name: 'Samir Ouali', role: 'supervisor', wilayaId: 16 },
  S2: { email: 'supervisor2', name: 'ليلى حدّاد', role: 'supervisor', wilayaId: 25 },
  S3: { email: 'supervisor3', name: 'Rachid Cherif', role: 'supervisor', wilayaId: 31 },
  S4: { email: 'supervisor4', name: 'مراد بن عمر', role: 'supervisor', wilayaId: 47 },
};

export const CLIENTS = {
  najma: {
    name: 'Café Najma',
    legalName: 'SARL Café Najma',
    contactName: 'Hakim Rezig',
    portal: { email: 'client.najma', name: 'Hakim Rezig' },
    products: [
      ['NJM-250', 'Café moulu Najma 250g', 'paquet', '480.00'],
      ['NJM-500', 'Café moulu Najma 500g', 'paquet', '890.00'],
      ['NJM-CAP', 'Capsules Najma ×10', 'boîte', '590.00'],
    ],
    stock: [
      ['gift', 'NJM-G1', 'Mug Najma', 'pièce'],
      ['gift', 'NJM-G2', 'Cuillère doseuse Najma', 'pièce'],
      ['sample', 'NJM-S1', 'Dosette de dégustation Najma', 'dosette'],
    ],
  },
  nour: {
    name: 'Nour Laitiers',
    legalName: 'SPA Nour Laitiers',
    contactName: 'Salima Khelifi',
    portal: { email: 'client.nour', name: 'Salima Khelifi' },
    products: [
      ['NOU-YF110', 'Yaourt Nour Fraise 110g', 'pot', '38.00'],
      ['NOU-YV110', 'Yaourt Nour Vanille 110g', 'pot', '38.00'],
      ['NOU-LBN1', 'Lben Nour 1 L', 'bouteille', '140.00'],
    ],
    stock: [
      ['gift', 'NOU-G1', 'Casquette Nour', 'pièce'],
      ['gift', 'NOU-G2', 'Sac isotherme Nour', 'pièce'],
      ['sample', 'NOU-S1', 'Mini-pot de dégustation Nour', 'pot'],
    ],
  },
};

/**
 * Stores: [code, name, type, wilayaId, latitude, longitude]. 40 stores in 9 wilayas.
 * Types are the enum values: superette, supermarket, hypermarket.
 */
export const STORES = [
  ['PDV-ALG-01', 'Hypermarché El Wiam — Bab Ezzouar', 'hypermarket', 16, 36.7238, 3.1825],
  ['PDV-ALG-02', 'Supermarché Rayhane — Kouba', 'supermarket', 16, 36.7312, 3.0845],
  ['PDV-ALG-03', 'Superette El Baraka — Hydra', 'superette', 16, 36.7448, 3.0396],
  ['PDV-ALG-04', 'Supermarché Atlas — Birkhadem', 'supermarket', 16, 36.7041, 3.0498],
  ['PDV-ALG-05', 'Superette Ibtissem — El Harrach', 'superette', 16, 36.7189, 3.1362],
  ['PDV-ALG-06', 'Hypermarché Safir — Chéraga', 'hypermarket', 16, 36.7664, 2.9427],
  ['PDV-ALG-07', 'Supermarché Soummam — Bab El Oued', 'supermarket', 16, 36.7893, 3.0508],
  ['PDV-ALG-08', 'Superette Nesrine — Bir Mourad Raïs', 'superette', 16, 36.7385, 3.0558],
  ['PDV-BLI-01', 'Supermarché Bahia — Blida centre', 'supermarket', 9, 36.4703, 2.8277],
  ['PDV-BLI-02', 'Superette El Amel — Ouled Yaïch', 'superette', 9, 36.4968, 2.8654],
  ['PDV-BLI-03', 'Superette El Hayat — Boufarik', 'superette', 9, 36.5732, 2.9086],
  ['PDV-BLI-04', 'Supermarché Chiffa — La Chiffa', 'supermarket', 9, 36.5129, 2.7746],
  ['PDV-TIP-01', 'Supermarché Chenoua — Tipaza centre', 'supermarket', 42, 36.5897, 2.4475],
  ['PDV-TIP-02', 'Superette Djebel — Koléa', 'superette', 42, 36.6394, 2.7678],
  ['PDV-TIP-03', 'Hypermarché Mitidja — Bou Ismaïl', 'hypermarket', 42, 36.6425, 2.6912],
  ['PDV-ORA-01', 'Hypermarché Es Salam — Oran', 'hypermarket', 31, 35.6911, -0.5876],
  ['PDV-ORA-02', 'Supermarché Wahrane — Bir El Djir', 'supermarket', 31, 35.7217, -0.5551],
  ['PDV-ORA-03', 'Superette Canastel — Canastel', 'superette', 31, 35.7432, -0.5368],
  ['PDV-ORA-04', 'Supermarché Medina — Es Senia', 'supermarket', 31, 35.6446, -0.6203],
  ['PDV-ORA-05', 'Superette Hai Sabah — Oran', 'superette', 31, 35.6989, -0.6342],
  ['PDV-TLE-01', 'Supermarché El Feth — Tlemcen centre', 'supermarket', 13, 34.8828, -1.3167],
  ['PDV-TLE-02', 'Superette Imama — Imama', 'superette', 13, 34.8774, -1.3341],
  ['PDV-TLE-03', 'Superette Zianides — Mansourah', 'superette', 13, 34.8712, -1.3495],
  ['PDV-SET-01', 'Supermarché Hodna — Sétif centre', 'supermarket', 19, 36.1898, 5.4108],
  ['PDV-SET-02', 'Hypermarché El Eulma — El Eulma', 'hypermarket', 19, 36.1522, 5.6874],
  ['PDV-SET-03', 'Superette Aïn Arnat — Aïn Arnat', 'superette', 19, 36.1789, 5.3187],
  ['PDV-SET-04', 'Superette Bougaa — Bougaa', 'superette', 19, 36.3321, 5.0907],
  ['PDV-CON-01', 'Hypermarché Rhumel — Ali Mendjeli', 'hypermarket', 25, 36.2566, 6.5662],
  ['PDV-CON-02', 'Supermarché Cirta — Constantine centre', 'supermarket', 25, 36.3652, 6.6147],
  ['PDV-CON-03', 'Superette El Khroub — El Khroub', 'superette', 25, 36.2602, 6.6935],
  ['PDV-CON-04', 'Superette Zouaghi — Zouaghi', 'superette', 25, 36.3419, 6.6254],
  ['PDV-CON-05', 'Supermarché Sidi Mabrouk — Sidi Mabrouk', 'supermarket', 25, 36.3405, 6.637],
  ['PDV-CON-06', 'Superette Boussouf — Boussouf', 'superette', 25, 36.3112, 6.6401],
  ['PDV-BIS-01', 'Supermarché Zibans — Biskra centre', 'supermarket', 7, 34.8504, 5.728],
  ['PDV-BIS-02', 'Superette Oasis — Sidi Okba', 'superette', 7, 34.7449, 5.9027],
  ['PDV-BIS-03', 'Superette El Alia — El Alia', 'superette', 7, 34.8296, 5.7478],
  ['PDV-GHA-01', 'Supermarché Mzab — Ghardaïa', 'supermarket', 47, 32.4909, 3.6736],
  ['PDV-GHA-02', 'Superette Beni Isguen — Beni Isguen', 'superette', 47, 32.4684, 3.7021],
  ['PDV-GHA-03', 'Supermarché Metlili — Metlili', 'supermarket', 47, 32.2663, 3.6359],
  ['PDV-GHA-04', 'Superette Bounoura — Bounoura', 'superette', 47, 32.4793, 3.7142],
];

/**
 * 24 Animateurs: [login key, name, wilayaId, store code, performance factor, role in the story].
 * The factor scales the daily sales target (1 = on target).
 */
export const ANIMATEURS = [
  ['yacine.haddad', 'Yacine Haddad', 16, 'PDV-ALG-01', 1.36, 'star'],
  ['amina.benali', 'أمينة بن علي', 16, 'PDV-ALG-02', 1.05],
  ['sara.boukrou', 'سارة بوكرو', 16, 'PDV-ALG-03', 0.95],
  ['yasmine.kacemi', 'ياسمين قاسمي', 16, 'PDV-ALG-04', 0.9, 'replaced'],
  ['hanane.tebbal', 'حنان طبّال', 16, 'PDV-ALG-05', 1.0, 'replacement'],
  ['imane.bensalem', 'Imane Bensalem', 9, 'PDV-BLI-01', 1.0],
  ['ayman.zerrouki', 'أيمن زروقي', 9, 'PDV-BLI-02', 0.92],
  ['nawel.bouzid', 'Nawel Bouzid', 42, 'PDV-TIP-01', 1.08],
  ['zoheir.amrani', 'زهير عمراني', 42, 'PDV-TIP-02', 0.98],
  ['karima.slimani', 'Karima Slimani', 19, 'PDV-SET-01', 1.03],
  ['mehdi.aouadi', 'مهدي عوادي', 19, 'PDV-SET-02', 1.1],
  ['lotfi.djebbar', 'لطفي جبّار', 25, 'PDV-CON-01', 0.97],
  ['adel.rahmani', 'عادل رحماني', 25, 'PDV-CON-02', 1.0],
  ['soraya.merah', 'Soraya Merah', 25, 'PDV-CON-03', 0.93],
  ['anis.cherfaoui', 'Anis Cherfaoui', 25, 'PDV-CON-04', 1.02],
  ['chahra.maamri', 'شهرة معمري', 25, 'PDV-CON-05', 0.95],
  ['meriem.hamdi', 'Meriem Hamdi', 31, 'PDV-ORA-01', 1.1],
  ['hamza.belhadj', 'حمزة بلحاج', 31, 'PDV-ORA-02', 1.0],
  ['nabil.guerfi', 'Nabil Guerfi', 31, 'PDV-ORA-03', 0.96],
  ['rym.amrani', 'ريم عمراني', 13, 'PDV-TLE-01', 1.06],
  ['bilal.mokhtari', 'Bilal Mokhtari', 13, 'PDV-TLE-02', 0.55, 'weak'],
  ['souad.cheniti', 'سعاد شنيتي', 7, 'PDV-BIS-01', 0.9],
  ['redouane.hadji', 'Redouane Hadji', 47, 'PDV-GHA-01', 0.88],
  ['amar.sebti', 'عمار سبتي', 47, 'PDV-GHA-02', 0.86],
];

/**
 * One justified leave with a replacement: `replaced` is absent from `leaveOffset` (days from the
 * run day), and `replacement` (also one of the 24, unassigned in the active campaign until then)
 * takes the same store from the next day.
 */
export const REPLACEMENT = {
  replaced: 'yasmine.kacemi',
  replacement: 'hanane.tebbal',
  leaveOffset: -9,
};

/** Stores each campaign covers besides the ones its Animateurs work in. */
export const EXTRA_STORES = {
  najma: ['PDV-ALG-06', 'PDV-ALG-07', 'PDV-BLI-03', 'PDV-ORA-04', 'PDV-SET-03', 'PDV-GHA-03'],
  nour: ['PDV-ALG-08', 'PDV-ORA-05', 'PDV-TLE-03', 'PDV-CON-06', 'PDV-BIS-02', 'PDV-GHA-04'],
  nourNext: ['PDV-ALG-06', 'PDV-BLI-03', 'PDV-ORA-04', 'PDV-SET-04', 'PDV-BIS-03'],
};

/**
 * Campaigns. Offsets are days from the run day. The closed campaign ended 3 weeks ago and the
 * active one started the next day, so the same Animateurs work both back to back.
 */
export const CAMPAIGNS = [
  {
    key: 'nour',
    client: 'nour',
    name: 'Lancement Yaourt Nour — Grandes Surfaces',
    description:
      'تقديم تذوقي لياغورت نور داخل المساحات التجارية الكبرى: عرض النكهات الجديدة، توزيع عينات صغيرة، وهدية عند اقتناء المنتج.',
    startOffset: -41,
    endOffset: -21,
    budget: '1850000.00',
    status: 'closed',
    targets: { dailyUnitsPerAnimateur: 10, dailySamplesPerAnimateur: 45 },
    giftPlan: { tierMax: 2 },
    tombola: { name: 'Tirage Nour — Grande tombola', winners: 3, reserves: 2 },
    prizes: ['Un an de yaourt Nour', 'Panier gourmand Nour', 'Bon d’achat 5 000 DA'],
  },
  {
    key: 'najma',
    client: 'najma',
    name: 'حملة تذوق الشتاء — قهوة نجمة',
    description:
      'حملة تذوق ميدانية لقهوة نجمة داخل المساحات التجارية الكبرى: تقديم الدوزيت، عرض الأحجام الجديدة، وتوزيع هدايا عند الشراء.',
    startOffset: -20,
    endOffset: 15,
    budget: '2400000.00',
    status: 'active',
    targets: { dailyUnitsPerAnimateur: 9, dailySamplesPerAnimateur: 40 },
    giftPlan: { tierMax: 2 },
    tombola: { name: 'Grand tirage Najma', winners: 3, reserves: 2 },
    prizes: ['Machine à café Najma', 'Coffret Najma', 'Mug collector Najma'],
  },
  {
    key: 'nourNext',
    client: 'nour',
    name: 'يوغورت نور بالفواكه — Nouvelle gamme',
    description:
      'إطلاق الحملة الجديدة لنور بالفواكه في المدن الكبرى: دعم مبيعات الأسبوع الأول وتشجيع التجربة الأولى.',
    startOffset: 7,
    endOffset: 37,
    budget: '1400000.00',
    status: 'planning',
    targets: { dailyUnitsPerAnimateur: 10, dailySamplesPerAnimateur: 45 },
    giftPlan: { tierMax: 2 },
    tombola: null,
    prizes: [],
  },
];

/** Wilayas of each campaign: the planned one only needs wilayas where it will recruit. */
export const PLANNED_WILAYAS = { 16: 4, 9: 1, 31: 3, 25: 2 };

export const FIRST_NAMES = [
  'Karim',
  'أمينة',
  'Yacine',
  'سارة',
  'Rachid',
  'Nadia',
  'وليد',
  'Lamia',
  'Samir',
  'مريم',
  'Ali',
  'Imane',
  'Mohamed',
  'Fatima',
  'Hocine',
  'خديجة',
  'Omar',
  'Sabrina',
  'Farouk',
  'Houda',
  'Tarek',
  'نور الدين',
  'Amel',
  'يوسف',
];
export const FAMILY_NAMES = [
  'Benali',
  'Haddad',
  'Boukhari',
  'Mansouri',
  'بن عمر',
  'Cherif',
  'Bensalem',
  'Zerrouki',
  'Ouali',
  'بلقاسم',
  'Mebarki',
  'Hamdi',
  'سعدي',
  'Belkacem',
  'Kaci',
  'Meziane',
  'Boudjemaa',
  'Merabet',
];

/** Issues of several categories and statuses: [campaign key, reporter, age in days, flow, ...]. */
export const ISSUES = [
  {
    category: 'pos_problem',
    title: 'نقل الركن الترويجي إلى مؤخرة المحل',
    description: 'مسؤول المحل نقل ركننا إلى الخلف، فلا يراه الزبائن عند الدخول.',
    by: 'amina.benali',
    campaign: 'najma',
    age: 2,
    flow: 'open',
  },
  {
    category: 'equipment',
    title: 'آلة تحضير القهوة معطلة',
    description: 'آلة التذوق لا تسخن منذ صباح اليوم، نحتاج إلى بديل في أقرب وقت.',
    by: 'mehdi.aouadi',
    campaign: 'najma',
    age: 8,
    flow: 'resolved',
  },
  {
    category: 'pos_problem',
    title: 'Mauvais emplacement du stand à l’entrée',
    description: 'Le stand bloque le passage des chariots, le gérant demande de le déplacer.',
    by: 'lotfi.djebbar',
    campaign: 'najma',
    age: 11,
    flow: 'resolved',
  },
  {
    category: 'other',
    title: 'تأخر وصول الهدايا إلى ولاية غرداية',
    description: 'لم نستلم الهدايا بعد، والشاحنة متأخرة منذ يومين.',
    by: 'redouane.hadji',
    campaign: 'najma',
    age: 3,
    flow: 'progress',
  },
  {
    category: 'absence',
    title: 'غياب زميلة بسبب المرض — طلب تعويض',
    description: 'زميلتي في المحل لن تعمل هذا الأسبوع، نطلب تعويضًا مؤقتًا لتفادي توقف الركن.',
    by: 'sara.boukrou',
    campaign: 'najma',
    age: 9,
    flow: 'resolved',
  },
  {
    category: 'equipment',
    title: 'Table de dégustation cassée',
    description: 'Un pied de la table s’est cassé pendant le montage du stand, à remplacer.',
    by: 'bilal.mokhtari',
    campaign: 'najma',
    age: 4,
    flow: 'progress',
  },
  {
    category: 'pos_problem',
    title: 'Réfrigérateur du magasin hors service',
    description: 'Les pots de démonstration ne peuvent pas être gardés au frais.',
    by: 'nawel.bouzid',
    campaign: 'najma',
    age: 1,
    flow: 'open',
  },
  {
    category: 'other',
    title: 'طلب مدير المحل تغيير ساعات التذوق',
    description: 'يرغب المسؤول في تأخير التذوق إلى ما بعد الظهر بسبب كثافة الزبائن صباحًا.',
    by: 'rym.amrani',
    campaign: 'najma',
    age: 6,
    flow: 'resolved',
  },
  {
    category: 'equipment',
    title: 'Affiche du stand déchirée',
    description:
      'L’affiche principale du stand est abîmée, il faut la remplacer avant le week-end.',
    by: 'karima.slimani',
    campaign: 'najma',
    age: 15,
    flow: 'resolved',
  },
];

export const ANNOUNCEMENTS = [
  {
    age: 20,
    campaign: 'najma',
    roles: ['supervisor', 'animateur', 'regional_manager'],
    title: 'انطلاق حملة تذوق الشتاء — قهوة نجمة',
    body: 'مرحبًا بكم في الحملة. أرسلوا صورة الحضور قبل التاسعة إلّا ربع، وسجّلوا كل عملية بيع في التطبيق فور حدوثها. بالتوفيق للجميع.',
  },
  {
    age: 9,
    campaign: 'najma',
    roles: ['animateur', 'supervisor'],
    wilaya: 16,
    title: 'زيارة ممثل العلامة إلى الجزائر العاصمة',
    body: 'سيزور ممثل قهوة نجمة نقاط البيع في العاصمة يوم الخميس. المطلوب: ركن نظيف، هدايا مرتّبة، وزيّ موحّد.',
  },
  {
    age: 4,
    campaign: null,
    roles: ['supervisor', 'animateur', 'regional_manager', 'general_manager'],
    title: 'Rappel : photo de clôture obligatoire',
    body: 'À partir de cette semaine, le pointage de clôture (17 h – 20 h) avec photo est obligatoire pour valider la journée.',
  },
];

export const ABSENCE_REASONS = ['مرض مفاجئ', 'موعد طبي', 'ظرف عائلي طارئ'];

export const REJECTION_REASONS = [
  'الصورة غير واضحة، يرجى إعادة التقاط الصورة غدًا.',
  'الصورة لا تُظهر الركن الترويجي.',
  'Photo prise hors du magasin, merci de pointer sur place.',
];

export const VISIT_NOTES = [
  'Linéaire bien approvisionné, stand propre.',
  'الركن منظم والهدايا في متناول الزبائن.',
  'Il faut ajouter des cadeaux avant le week-end.',
  'الفريق يحتاج إلى دعم إضافي بعد الظهر.',
  'تم التأكد من توفر المنتجات على الرفوف.',
];

/**
 * A tiny cast for the fast test (`runShowcase({ tiny: true })`): one running campaign, four
 * Animateurs of three supervisors in three stores, three days of activity.
 */
export const TINY = {
  animateurs: [
    ['yacine.haddad', 'PDV-ALG-01'],
    ['amina.benali', 'PDV-ALG-01'],
    ['hamza.belhadj', 'PDV-ORA-02'],
    ['souad.cheniti', 'PDV-BIS-01'],
  ],
  campaign: {
    key: 'najma',
    startOffset: -2,
    endOffset: 5,
    targets: { dailyUnitsPerAnimateur: 4, dailySamplesPerAnimateur: 10 },
  },
};
