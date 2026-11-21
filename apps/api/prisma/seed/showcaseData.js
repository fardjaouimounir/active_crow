// Static, entirely fictional content for the showcase agency: people, brands, stores, texts.
// Names are common Algerian given names and family names combined at random; brands and shops are
// invented. Nothing here refers to a real person, company or product.

export const AGENCY = { code: 'ACTICREW-SHOWCASE', name: 'Tamayouz Animation' };
export const EMAIL_DOMAIN = 'showcase.test';

// wilayaId → [region key, supervisor key]
export const WILAYA_PLAN = {
  16: ['centre', 'S1'],
  9: ['centre', 'S1'],
  31: ['centre', 'S2'],
  13: ['centre', 'S2'],
  25: ['est', 'S3'],
  19: ['est', 'S3'],
  23: ['est', 'S3'],
  5: ['est', 'S3'],
  17: ['est', 'S4'],
  47: ['est', 'S4'],
  30: ['est', 'S4'],
};

export const REGIONS = [
  { key: 'centre', code: 'SC-CENTRE', name: 'Centre & Ouest', wilayas: [16, 9, 31, 13] },
  {
    key: 'est',
    code: 'SC-EST',
    name: 'Est, Hauts-Plateaux & Sud',
    wilayas: [25, 19, 23, 5, 17, 47, 30],
  },
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
  est: { email: 'regional.est', name: 'نادية سعدي', role: 'regional_manager', wilayaId: 25 },
  S1: { email: 'supervisor.alger', name: 'Samir Ouali', role: 'supervisor', wilayaId: 16 },
  S2: { email: 'supervisor.oran', name: 'ليلى حدّاد', role: 'supervisor', wilayaId: 31 },
  S3: { email: 'supervisor.est', name: 'Rachid Cherif', role: 'supervisor', wilayaId: 25 },
  S4: { email: 'supervisor.sud', name: 'مراد بن عمر', role: 'supervisor', wilayaId: 17 },
};

export const CLIENTS = {
  nedjma: {
    name: 'Torréfaction Nedjma',
    legalName: 'SARL Torréfaction Nedjma',
    contactName: 'Hakim Rezig',
    portal: { email: 'client.nedjma', name: 'Hakim Rezig' },
    products: [
      ['NDJ-250', 'Café moulu Nedjma 250 g', 'paquet', '480.00'],
      ['NDJ-500', 'Café moulu Nedjma 500 g', 'paquet', '890.00'],
      ['NDJ-CAP', 'Capsules Nedjma ×10', 'boîte', '590.00'],
    ],
    stock: [
      ['gift', 'NDJ-G1', 'Tasse émaillée Nedjma', 'pièce'],
      ['gift', 'NDJ-G2', 'Cuillère doseuse Nedjma', 'pièce'],
      ['sample', 'NDJ-S1', 'Dosette de dégustation', 'dosette'],
    ],
  },
  nour: {
    name: 'Laiterie Nour',
    legalName: 'SPA Laiterie Nour',
    contactName: 'Salima Khelifi',
    portal: { email: 'client.nour', name: 'Salima Khelifi' },
    products: [
      ['NOU-NAT4', 'Yaourt Nour nature ×4', 'pack', '220.00'],
      ['NOU-FRU4', 'Yaourt Nour fruits ×4', 'pack', '260.00'],
      ['NOU-LBN', 'Lben Nour 1 L', 'bouteille', '140.00'],
    ],
    stock: [
      ['gift', 'NOU-G1', 'Sac isotherme Nour', 'pièce'],
      ['gift', 'NOU-G2', 'Pot réutilisable Nour', 'pièce'],
      ['sample', 'NOU-S1', 'Mini-pot de dégustation', 'pot'],
    ],
  },
};

// Stores: [code, name, type, wilayaId, latitude, longitude]
export const STORES = [
  ['SC-ALG-01', 'Superette El Baraka — Bab Ezzouar', 'superette', 16, 36.7238, 3.1825],
  ['SC-ALG-02', 'Hypermarché Tassili — Dar El Beïda', 'hypermarket', 16, 36.7132, 3.2121],
  ['SC-ALG-03', 'Supermarché El Wiam — Hydra', 'supermarket', 16, 36.7448, 3.0396],
  ['SC-ALG-04', 'Market Rayhane — Kouba', 'superette', 16, 36.7312, 3.0845],
  ['SC-ALG-05', 'Supérette Ibtissem — El Harrach', 'superette', 16, 36.7189, 3.1362],
  ['SC-ALG-06', 'Supermarché Atlas — Bir Mourad Raïs', 'supermarket', 16, 36.7385, 3.0558],
  ['SC-ALG-07', 'Hypermarché Safir — Chéraga', 'hypermarket', 16, 36.7664, 2.9427],
  ['SC-ALG-08', 'Superette Soummam — Birkhadem', 'superette', 16, 36.7041, 3.0498],
  ['SC-BLI-01', 'Supermarché Bahia — Blida centre', 'supermarket', 9, 36.4703, 2.8277],
  ['SC-BLI-02', 'Superette El Amel — Ouled Yaïch', 'superette', 9, 36.4968, 2.8654],
  ['SC-BLI-03', 'Market El Hayat — Boufarik', 'superette', 9, 36.5732, 2.9086],
  ['SC-ORA-01', 'Hypermarché Tassili — Oran', 'hypermarket', 31, 35.6911, -0.5876],
  ['SC-ORA-02', 'Supermarché Es Salam — Bir El Djir', 'supermarket', 31, 35.7217, -0.5551],
  ['SC-ORA-03', 'Superette Canastel — Canastel', 'superette', 31, 35.7432, -0.5368],
  ['SC-ORA-04', 'Supermarché Medina — Es Senia', 'supermarket', 31, 35.6446, -0.6203],
  ['SC-TLE-01', 'Supermarché El Feth — Tlemcen centre', 'supermarket', 13, 34.8828, -1.3167],
  ['SC-TLE-02', 'Superette Imama — Imama', 'superette', 13, 34.8774, -1.3341],
  ['SC-TLE-03', 'Market Zianides — Mansourah', 'superette', 13, 34.8712, -1.3495],
  ['SC-CON-01', 'Hypermarché Rhumel — Ali Mendjeli', 'hypermarket', 25, 36.2566, 6.5662],
  ['SC-CON-02', 'Supermarché Cirta — Constantine centre', 'supermarket', 25, 36.3652, 6.6147],
  ['SC-CON-03', 'Superette El Khroub — El Khroub', 'superette', 25, 36.2602, 6.6935],
  ['SC-SET-01', 'Supermarché Hodna — Sétif centre', 'supermarket', 19, 36.1898, 5.4108],
  ['SC-SET-02', 'Hypermarché El Eulma — El Eulma', 'hypermarket', 19, 36.1522, 5.6874],
  ['SC-SET-03', 'Superette Ain Arnat — Aïn Arnat', 'superette', 19, 36.1789, 5.3187],
  ['SC-ANN-01', 'Supermarché Seybouse — Annaba centre', 'supermarket', 23, 36.9019, 7.7667],
  ['SC-ANN-02', 'Superette Edough — El Bouni', 'superette', 23, 36.8465, 7.7142],
  ['SC-ANN-03', 'Market Corniche — Sidi Amar', 'superette', 23, 36.8323, 7.7791],
  ['SC-BAT-01', 'Supermarché Aurès — Batna centre', 'supermarket', 5, 35.5559, 6.1741],
  ['SC-BAT-02', 'Superette Chaouia — Parc Forestier', 'superette', 5, 35.5688, 6.1952],
  ['SC-BAT-03', 'Hypermarché Timgad — Batna', 'hypermarket', 5, 35.5405, 6.1523],
  ['SC-DJE-01', 'Supermarché El Wahat — Djelfa centre', 'supermarket', 17, 34.6704, 3.2631],
  ['SC-DJE-02', 'Superette Ennakhil — Djelfa', 'superette', 17, 34.6852, 3.2476],
  ['SC-GHA-01', 'Supermarché Mzab — Ghardaïa', 'supermarket', 47, 32.4909, 3.6736],
  ['SC-GHA-02', 'Superette Beni Isguen — Beni Isguen', 'superette', 47, 32.4684, 3.7021],
  ['SC-OUA-01', 'Supermarché Sahara — Ouargla centre', 'supermarket', 30, 31.9527, 5.3249],
  ['SC-OUA-02', 'Superette Oasis — Ouargla', 'superette', 30, 31.9385, 5.3402],
  ['SC-ORA-05', 'Superette Hai Sabah — Oran', 'superette', 31, 35.6989, -0.6342],
  ['SC-CON-04', 'Market Zouaghi — Constantine', 'superette', 25, 36.3419, 6.6254],
  ['SC-ALG-09', 'Supermarché Bab El Oued — Alger', 'supermarket', 16, 36.7893, 3.0508],
  ['SC-SET-04', 'Market Bougaa — Sétif', 'superette', 19, 36.3321, 5.0907],
];

/**
 * Animateurs: [email key, name, wilayaId, campaign ('nedjma' | 'nour' | 'proposed'), store code,
 * performance factor]. The factor drives how many sales a day (1 = average).
 */
export const ANIMATEURS = [
  ['amina.benali', 'أمينة بن علي', 16, 'nedjma', 'SC-ALG-01', 1.5],
  ['yacine.haddad', 'Yacine Haddad', 16, 'nedjma', 'SC-ALG-02', 2.1], // the star store
  ['sara.boukrou', 'سارة بوكرو', 16, 'nedjma', 'SC-ALG-03', 1.1],
  ['walid.mansouri', 'Walid Mansouri', 16, 'nedjma', 'SC-ALG-04', 1.0],
  ['yasmine.kacemi', 'ياسمين قاسمي', 16, 'nedjma', 'SC-ALG-05', 0.9],
  ['imane.bensalem', 'Imane Bensalem', 9, 'nedjma', 'SC-BLI-01', 1.0],
  ['ayman.zerrouki', 'أيمن زروقي', 9, 'nedjma', 'SC-BLI-02', 0.8],
  ['meriem.hamdi', 'Meriem Hamdi', 31, 'nedjma', 'SC-ORA-01', 1.3],
  ['hamza.belhadj', 'حمزة بلحاج', 31, 'nedjma', 'SC-ORA-02', 1.0],
  ['soraya.merah', 'Soraya Merah', 31, 'nedjma', 'SC-ORA-03', 0.9],
  ['lotfi.djebbar', 'لطفي جبّار', 25, 'nedjma', 'SC-CON-01', 1.2],
  ['nawel.bouzid', 'Nawel Bouzid', 25, 'nedjma', 'SC-CON-02', 1.0],
  ['adel.rahmani', 'عادل رحماني', 25, 'nedjma', 'SC-CON-03', 0.8],
  ['karima.slimani', 'Karima Slimani', 19, 'nedjma', 'SC-SET-01', 1.1],
  ['mehdi.aouadi', 'مهدي عوادي', 19, 'nedjma', 'SC-SET-02', 1.2],
  ['abdelkader.touati', 'Abdelkader Touati', 17, 'nedjma', 'SC-DJE-01', 0.35], // the weak wilaya
  ['ikram.ouartsi', 'إكرام وارتسي', 47, 'nedjma', 'SC-GHA-01', 0.7],
  ['nabil.guerfi', 'Nabil Guerfi', 31, 'nour', 'SC-ORA-05', 1.1],
  ['rym.amrani', 'ريم عمراني', 13, 'nour', 'SC-TLE-01', 1.2],
  ['bilal.mokhtari', 'Bilal Mokhtari', 13, 'nour', 'SC-TLE-02', 0.9],
  ['hanane.tebbal', 'حنان طبّال', 23, 'nour', 'SC-ANN-01', 1.4],
  ['sofiane.laribi', 'Sofiane Laribi', 23, 'nour', 'SC-ANN-02', 1.0],
  ['dalila.benzaid', 'دليلة بن زايد', 5, 'nour', 'SC-BAT-01', 1.0],
  ['amar.sebti', 'Amar Sebti', 5, 'nour', 'SC-BAT-02', 0.8],
  ['fatima.zohra.mebarek', 'فاطمة الزهراء مبارك', 30, 'nour', 'SC-OUA-01', 0.6],
  ['redouane.hadji', 'Redouane Hadji', 17, 'proposed', 'SC-DJE-02', 1],
  ['souad.cheniti', 'سعاد شنيتي', 19, 'proposed', 'SC-SET-03', 1],
  ['lamine.guerrouj', 'Lamine Guerrouj', 17, 'bench', 'SC-DJE-01', 1], // replaces the absent one
];

// Which stores each campaign covers (assigned or not).
export const CAMPAIGN_STORES = {
  nedjma: [
    'SC-ALG-01',
    'SC-ALG-02',
    'SC-ALG-03',
    'SC-ALG-04',
    'SC-ALG-05',
    'SC-ALG-06',
    'SC-ALG-07',
    'SC-BLI-01',
    'SC-BLI-02',
    'SC-BLI-03',
    'SC-ORA-01',
    'SC-ORA-02',
    'SC-ORA-03',
    'SC-ORA-04',
    'SC-CON-01',
    'SC-CON-02',
    'SC-CON-03',
    'SC-SET-01',
    'SC-SET-02',
    'SC-SET-03',
    'SC-DJE-01',
    'SC-DJE-02',
    'SC-GHA-01',
    'SC-GHA-02',
  ],
  nour: [
    'SC-ORA-05',
    'SC-ORA-04',
    'SC-TLE-01',
    'SC-TLE-02',
    'SC-TLE-03',
    'SC-ANN-01',
    'SC-ANN-02',
    'SC-ANN-03',
    'SC-BAT-01',
    'SC-BAT-02',
    'SC-BAT-03',
    'SC-OUA-01',
    'SC-OUA-02',
  ],
};

export const CAMPAIGNS = [
  {
    key: 'nedjma',
    client: 'nedjma',
    name: 'حملة تذوق الشتاء — قهوة نجمة',
    description:
      'حملة تذوق ميدانية لقهوة نجمة داخل المساحات التجارية الكبرى: تقديم الدوزيت، عرض الأحجام الجديدة، وتوزيع هدايا عند الشراء.',
    startOffset: -21,
    endOffset: 14,
    budget: '2400000.00',
    requiredPerWilaya: { 16: 5, 9: 2, 31: 3, 25: 3, 19: 2, 17: 2, 47: 1 },
    giftPlan: { perAnimateur: [260, 200], tierMax: 2 },
    targets: { dailyUnitsPerAnimateur: 14, dailySamplesPerAnimateur: 40 },
    tombola: { name: 'Grand tirage Nedjma', winners: 3, reserves: 2 },
  },
  {
    key: 'nour',
    client: 'nour',
    name: 'Lancement Yaourt Nour — Hiver gourmand',
    description:
      'Lancement de la nouvelle gamme Yaourt Nour dans les supermarchés de l’Ouest, de l’Est et du Sud : dégustation, conseil et cadeaux à l’achat.',
    startOffset: -12,
    endOffset: 24,
    budget: '1650000.00',
    requiredPerWilaya: { 31: 1, 13: 2, 23: 2, 5: 2, 30: 1 },
    giftPlan: { perAnimateur: [160, 140], tierMax: 2 },
    targets: { dailyUnitsPerAnimateur: 18, dailySamplesPerAnimateur: 50 },
    tombola: null,
  },
];

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
];

export const ISSUES = [
  {
    category: 'pos_problem',
    title: 'نقل الركن الترويجي إلى مؤخرة المحل',
    description: 'مسؤول المحل نقل ركننا إلى الخلف، فلا يراه الزبائن عند الدخول.',
    by: 'amina.benali',
    campaign: 'nedjma',
    age: 2,
    flow: 'open',
  },
  {
    category: 'stock_shortage',
    title: 'Rupture de tasses — stand presque vide',
    description: 'Il reste moins de 15 tasses, la demande dépasse ce que nous avons reçu.',
    by: 'yacine.haddad',
    campaign: 'nedjma',
    age: 5,
    flow: 'progress',
  },
  {
    category: 'equipment',
    title: 'Machine à café en panne',
    description: 'La machine de dégustation ne chauffe plus depuis ce matin.',
    by: 'mehdi.aouadi',
    campaign: 'nedjma',
    age: 8,
    flow: 'resolved',
  },
  {
    category: 'pos_problem',
    title: 'Réfrigérateur du magasin hors service',
    description: 'Les yaourts de démonstration ne peuvent pas être gardés au frais.',
    by: 'hanane.tebbal',
    campaign: 'nour',
    age: 1,
    flow: 'open',
  },
  {
    category: 'other',
    title: 'تأخر وصول الهدايا إلى ولاية ورقلة',
    description: 'لم نستلم الهدايا بعد، والشاحنة متأخرة منذ يومين.',
    by: 'fatima.zohra.mebarek',
    campaign: 'nour',
    age: 3,
    flow: 'progress',
  },
  {
    category: 'pos_problem',
    title: 'Mauvais emplacement du stand à l’entrée',
    description: 'Le stand bloque le passage des chariots, le gérant demande de le déplacer.',
    by: 'lotfi.djebbar',
    campaign: 'nedjma',
    age: 11,
    flow: 'resolved',
  },
];

export const ANNOUNCEMENTS = [
  {
    age: 20,
    campaign: 'nedjma',
    roles: ['supervisor', 'animateur', 'regional_manager'],
    title: 'انطلاق حملة تذوق الشتاء — قهوة نجمة',
    body: 'مرحبًا بكم في الحملة. أرسلوا صورة الحضور قبل التاسعة إلّا ربع، وسجّلوا كل عملية بيع في التطبيق فور حدوثها. بالتوفيق للجميع.',
  },
  {
    age: 12,
    campaign: 'nour',
    roles: ['supervisor', 'animateur', 'regional_manager'],
    title: 'Lancement Yaourt Nour — consignes terrain',
    body: 'Le stand doit rester à moins de 3 m de la vitrine réfrigérée. Respectez la chaîne du froid et photographiez le stand à l’ouverture et à la fermeture.',
  },
  {
    age: 9,
    campaign: 'nedjma',
    roles: ['animateur', 'supervisor'],
    wilaya: 16,
    title: 'زيارة مدير العلامة إلى الجزائر العاصمة',
    body: 'سيزور ممثل نجمة نقاط البيع في العاصمة يوم الخميس. المطلوب: ركن نظيف، هدايا مرتّبة، وزيّ موحّد.',
  },
  {
    age: 6,
    campaign: null,
    roles: ['supervisor', 'animateur', 'regional_manager', 'general_manager'],
    title: 'Rappel : photo de clôture obligatoire',
    body: 'À partir de cette semaine, le pointage de clôture (17 h – 20 h) avec photo est obligatoire pour valider la journée.',
  },
  {
    age: 3,
    campaign: 'nedjma',
    roles: ['animateur'],
    wilaya: 17,
    title: 'دعم إضافي لولاية الجلفة',
    body: 'سينضم زميل جديد إلى الجلفة هذا الأسبوع. المشرف سيتصل بكم لتنسيق المناوبات.',
  },
  {
    age: 1,
    campaign: 'nedjma',
    roles: ['supervisor', 'animateur', 'regional_manager'],
    title: 'Tirage au sort Nedjma — dernière ligne droite',
    body: 'Pensez à demander le consentement des clients pour le tirage au sort : chaque participation compte avant la clôture des inscriptions.',
  },
];

export const ABSENCE_REASONS = [
  'مرض مفاجئ',
  'Raison familiale',
  'Transport indisponible',
  'موعد طبي',
];
