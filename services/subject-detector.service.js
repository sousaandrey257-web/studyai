'use strict';
// Multilingual subject detector — 12 categories × 20 languages
// Returns { category, allowsMath, sectionStyle, focus, confidence }

const SUBJECTS = {

  // ── HISTORY — never math ────────────────────────────────────────────────
  history: {
    allowsMath: false,
    sectionStyle: 'chronological',
    focus: ['dates', 'events', 'key figures', 'causes', 'consequences', 'context'],
    kw: {
      fr: ['histoire','historique','révolution','guerre mondiale','première guerre','deuxième guerre','empire romain','antiquité','moyen âge','renaissance','siècle','napoléon','rome','grèce antique','égypte','monarchie','colonisation','croisade','féodalité','shoah','louis xiv','charlemagne'],
      en: ['history','historical','revolution','world war','empire','antiquity','middle ages','renaissance','century','napoleon','rome','ancient greece','egypt','monarchy','colonization','crusades','feudalism','holocaust','civil war'],
      es: ['historia','histórico','revolución','guerra mundial','imperio','antigüedad','edad media','siglo','napoleón','roma','grecia antigua','colonización','cruzadas','feudalismo','monarquía'],
      de: ['geschichte','historisch','revolution','weltkrieg','imperium','mittelalter','jahrhundert','napoleon','kolonisation','kreuzzüge','feudalismus','monarchie'],
      pt: ['história','histórico','revolução','guerra mundial','império','antiguidade','idade média','século','napoleão','colonização','feudalismo','monarquia'],
      'pt-BR': ['história','histórico','revolução','guerra mundial','império','antiguidade','idade média','século','napoleão'],
      it: ['storia','storico','rivoluzione','guerra mondiale','impero','antichità','medioevo','secolo','napoleone','colonizzazione','feudalesimo','monarchia'],
      nl: ['geschiedenis','historisch','revolutie','wereldoorlog','imperium','middeleeuwen','eeuw','napoleon','kolonisatie','feodalisme','monarchie'],
      zh: ['历史','革命','战争','帝国','古代','中世纪','世纪','拿破仑','罗马','埃及','王朝','朝代','封建','殖民','文明'],
      ja: ['歴史','革命','戦争','帝国','古代','中世','世紀','ナポレオン','ローマ','エジプト','王朝','封建','植民地','文明'],
      ko: ['역사','혁명','전쟁','제국','고대','중세','세기','나폴레옹','로마','이집트','봉건','식민지'],
      id: ['sejarah','historis','revolusi','perang dunia','kekaisaran','abad','kuno','pertengahan','kolonisasi','feodalisme','monarki'],
      ar: ['تاريخ','تاريخي','ثورة','حرب عالمية','إمبراطورية','العصور الوسطى','قرن','روما','مصر القديمة','استعمار','إقطاع','ملكية'],
      tr: ['tarih','tarihsel','devrim','dünya savaşı','imparatorluk','antik','ortaçağ','yüzyıl','napolyon','sömürgecilik','feodalizm','monarşi'],
      th: ['ประวัติศาสตร์','การปฏิวัติ','สงคราม','จักรวรรดิ','ยุคกลาง','ศตวรรษ','โรมัน','ระบบศักดินา','อาณานิคม'],
      ru: ['истори','историч','революци','мировой войн','второй мировой','империи','империя','античн','средневеков','наполеон','колонизаци','феодализм','монархи'],
      pl: ['historia','historyczny','rewolucja','wojna światowa','imperium','starożytność','średniowiecze','wiek','napoleon','kolonizacja','feudalizm','monarchia'],
      vi: ['lịch sử','cách mạng','chiến tranh','đế quốc','cổ đại','trung cổ','thế kỷ','napoleon','phong kiến','thuộc địa'],
      hi: ['इतिहास','ऐतिहासिक','क्रांति','विश्व युद्ध','साम्राज्य','प्राचीन','मध्ययुग','शताब्दी','सामंतवाद','उपनिवेश'],
      uk: ['істори','историч','революці','світової війн','другої світової','імпері','антич','середньовіч','наполеон','колонізаці','феодалізм','монарх'],
    }
  },

  // ── PHILOSOPHY — never math ─────────────────────────────────────────────
  philosophy: {
    allowsMath: false,
    sectionStyle: 'conceptual',
    focus: ['core concepts', 'key arguments', 'thinkers', 'movements', 'texts'],
    kw: {
      fr: ['philosophie','philo','kant','descartes','platon','aristote','nietzsche','sartre','hegel','socrate','rousseau','voltaire','éthique','morale','métaphysique','épistémologie','ontologie','existentialisme','utilitarisme','empirisme','rationalisme'],
      en: ['philosophy','philosophical','kant','descartes','plato','aristotle','nietzsche','sartre','hegel','socrates','rousseau','ethics','morality','metaphysics','epistemology','ontology','existentialism','utilitarianism','empiricism','rationalism'],
      es: ['filosofía','filosófico','kant','platón','aristóteles','nietzsche','sartre','hegel','sócrates','rousseau','ética','moral','metafísica','epistemología','ontología','existencialismo'],
      de: ['philosophie','philosophisch','kant','platon','aristoteles','nietzsche','sartre','hegel','sokrates','rousseau','ethik','moral','metaphysik','erkenntnistheorie','ontologie','existenzialismus'],
      pt: ['filosofia','filosófico','kant','platão','aristóteles','nietzsche','sartre','hegel','sócrates','rousseau','ética','moral','metafísica','epistemologia','existencialismo'],
      'pt-BR': ['filosofia','filosófico','kant','platão','aristóteles','nietzsche','sartre','ética','moral','metafísica'],
      it: ['filosofia','filosofico','kant','platone','aristotele','nietzsche','sartre','hegel','socrate','rousseau','etica','morale','metafisica','epistemologia','esistenzialismo'],
      nl: ['filosofie','filosofisch','kant','plato','aristoteles','nietzsche','sartre','hegel','socrates','rousseau','ethiek','moraal','metafysica','epistemologie','existentialisme'],
      zh: ['哲学','康德','笛卡尔','柏拉图','亚里士多德','尼采','萨特','黑格尔','苏格拉底','卢梭','伦理','道德','形而上学','认识论','存在主义'],
      ja: ['哲学','カント','デカルト','プラトン','アリストテレス','ニーチェ','サルトル','ヘーゲル','ソクラテス','ルソー','倫理','道徳','形而上学','存在論','実存主義'],
      ko: ['철학','칸트','데카르트','플라톤','아리스토텔레스','니체','사르트르','헤겔','소크라테스','루소','윤리','도덕','형이상학','존재론','실존주의'],
      id: ['filsafat','filosofi','kant','descartes','plato','aristoteles','nietzsche','sartre','hegel','socrates','etika','moral','metafisika','epistemologi','eksistensialisme'],
      ar: ['فلسفة','فلسفي','كانط','ديكارت','أفلاطون','أرسطو','نيتشه','سارتر','هيغل','سقراط','روسو','أخلاق','ميتافيزيقيا','إبستيمولوجيا','وجودية'],
      tr: ['felsefe','felsefi','kant','descartes','platon','aristoteles','nietzsche','sartre','hegel','sokrates','rousseau','etik','ahlak','metafizik','epistemoloji','varoluşçuluk'],
      th: ['ปรัชญา','คานท์','เดส์การ์ต','เพลโต','อริสโตเติล','นีทเช่','ซาร์ตร์','เฮเกล','โสกราตีส','รูโซ','จริยธรรม','อภิปรัชญา','ญาณวิทยา'],
      ru: ['философия','философский','кант','декарт','платон','аристотель','ницше','сартр','гегель','сократ','руссо','этика','мораль','метафизика','онтология','экзистенциализм'],
      pl: ['filozofia','filozoficzny','kant','descartes','platon','arystoteles','nietzsche','sartre','hegel','sokrates','rousseau','etyka','moralność','metafizyka','epistemologia','egzystencjalizm'],
      vi: ['triết học','kant','descartes','platon','aristoteles','nietzsche','sartre','hegel','socrates','rousseau','đạo đức','siêu hình học','nhận thức luận','chủ nghĩa hiện sinh'],
      hi: ['दर्शन','दर्शनशास्त्र','कांट','देकार्त','प्लेटो','अरस्तू','नित्शे','सार्त्र','हेगेल','सुकरात','रूसो','नैतिकता','तत्त्वमीमांसा','ज्ञानमीमांसा','अस्तित्ववाद'],
      uk: ['філософія','філософський','кант','декарт','платон','арістотель','ніцше','сартр','гегель','сократ','руссо','етика','мораль','метафізика','онтологія','екзистенціалізм'],
    }
  },

  // ── LITERATURE — never math ─────────────────────────────────────────────
  literature: {
    allowsMath: false,
    sectionStyle: 'analytical',
    focus: ['themes', 'literary devices', 'historical context', 'characters', 'authors'],
    kw: {
      fr: ['littérature','littéraire','roman','poésie','poème','théâtre','auteur','baudelaire','hugo','molière','voltaire','zola','flaubert','balzac','camus','proust','racine','corneille','rimbaud','verlaine'],
      en: ['literature','literary','novel','poetry','poem','theater','author','shakespeare','dickens','fitzgerald','hemingway','orwell','joyce','austen','tolstoy','dostoevsky'],
      es: ['literatura','literario','novela','poesía','poema','teatro','autor','cervantes','lorca','borges','neruda','García Márquez','quevedo','góngora'],
      de: ['literatur','literarisch','roman','poesie','gedicht','theater','autor','goethe','schiller','kafka','brecht','hesse','mann','grass'],
      pt: ['literatura','literário','romance','poesia','poema','teatro','autor','pessoa','camões','eça de queirós','saramago'],
      'pt-BR': ['literatura','literário','romance','poesia','poema','teatro','autor','machado de assis','guimarães rosa','clarice lispector','drummond'],
      it: ['letteratura','letterario','romanzo','poesia','poema','teatro','autore','dante','manzoni','calvino','pavese','leopardi','ariosto'],
      nl: ['literatuur','literair','roman','poëzie','gedicht','theater','auteur','multatuli','vondel','hermans'],
      zh: ['文学','文学的','小说','诗歌','诗','戏剧','作者','鲁迅','莎士比亚','巴金','老舍','曹雪芹','李白','杜甫'],
      ja: ['文学','小説','詩','戯曲','著者','夏目漱石','川端康成','三島由紀夫','太宰治','芥川龍之介','シェイクスピア'],
      ko: ['문학','소설','시','연극','작가','셰익스피어','이상','김소월','윤동주','박경리'],
      id: ['sastra','sastrawi','novel','puisi','drama','pengarang','pramoedya ananta toer','chairil anwar','hamka'],
      ar: ['أدب','أدبي','رواية','شعر','قصيدة','مسرح','شكسبير','نجيب محفوظ','المتنبي','طه حسين','جبران خليل'],
      tr: ['edebiyat','edebi','roman','şiir','tiyatro','yazar','orhan pamuk','nazım hikmet','yahya kemal','tanpınar','yunus emre'],
      th: ['วรรณกรรม','วรรณคดี','นิยาย','กวีนิพนธ์','ละคร','ผู้แต่ง','สุนทรภู่','ขุนช้างขุนแผน'],
      ru: ['литература','литературный','роман','поэзия','стихи','театр','автор','пушкин','толстой','достоевский','чехов','гоголь','тургенев','булгаков'],
      pl: ['literatura','literacki','powieść','poezja','wiersz','teatr','autor','mickiewicz','słowacki','szymborska','miłosz','sienkiewicz'],
      vi: ['văn học','văn chương','tiểu thuyết','thơ ca','kịch','tác giả','nguyễn du','truyện kiều','nam quốc sơn hà','hồ xuân hương'],
      hi: ['साहित्य','साहित्यिक','उपन्यास','कविता','नाटक','लेखक','प्रेमचंद','कालिदास','तुलसीदास','रवींद्रनाथ'],
      uk: ['література','літературний','роман','поезія','вірш','театр','автор','шевченко','франко','леся українка','коцюбинський'],
    }
  },

  // ── GEOGRAPHY — never math ──────────────────────────────────────────────
  geography: {
    allowsMath: false,
    sectionStyle: 'factual',
    focus: ['locations', 'climate', 'demographics', 'economy', 'environment'],
    kw: {
      fr: ['géographie','géographique','pays','continent','climat','relief','population','capitale','fleuve','montagne','afrique','asie','europe','amériques','océanie','biome','désert','tectonic'],
      en: ['geography','geographic','country','continent','climate','relief','population','capital city','river','mountain','africa','asia','europe','americas','oceania','biome','desert','tectonic'],
      es: ['geografía','geográfico','país','continente','clima','capital','río','montaña','africa','asia','europa','demografía','bioma'],
      de: ['geografie','geographie','land','kontinent','klima','hauptstadt','fluss','berg','afrika','asien','europa','bevölkerung','biom'],
      pt: ['geografia','país','continente','clima','capital','rio','montanha','africa','ásia','europa','população','bioma'],
      'pt-BR': ['geografia','país','continente','clima','capital','rio','montanha','africa','ásia','europa'],
      it: ['geografia','paese','continente','clima','capitale','fiume','montagna','africa','asia','europa','popolazione','bioma'],
      nl: ['geografie','land','continent','klimaat','hoofdstad','rivier','berg','afrika','azië','europa','bevolking','bioom'],
      zh: ['地理','国家','大陆','气候','首都','河流','山脉','非洲','亚洲','欧洲','美洲','人口','生物群落'],
      ja: ['地理','国','大陸','気候','首都','川','山','アフリカ','アジア','ヨーロッパ','人口','生態系'],
      ko: ['지리','국가','대륙','기후','수도','강','산','아프리카','아시아','유럽','인구'],
      id: ['geografi','negara','benua','iklim','ibu kota','sungai','gunung','africa','asia','eropa','penduduk','bioma'],
      ar: ['جغرافيا','بلد','قارة','مناخ','عاصمة','نهر','جبل','إفريقيا','آسيا','أوروبا','سكان','بيئة'],
      tr: ['coğrafya','ülke','kıta','iklim','başkent','nehir','dağ','afrika','asya','avrupa','nüfus','biyom'],
      th: ['ภูมิศาสตร์','ประเทศ','ทวีป','ภูมิอากาศ','เมืองหลวง','แม่น้ำ','ภูเขา','แอฟริกา','เอเชีย','ยุโรป','ประชากร'],
      ru: ['география','страна','континент','климат','столица','река','гора','африка','азия','европа','население','биом'],
      pl: ['geografia','kraj','kontynent','klimat','stolica','rzeka','góra','afryka','azja','europa','ludność','biom'],
      vi: ['địa lý','quốc gia','lục địa','khí hậu','thủ đô','sông','núi','châu phi','châu á','châu âu','dân số'],
      hi: ['भूगोल','देश','महाद्वीप','जलवायु','राजधानी','नदी','पर्वत','अफ्रीका','एशिया','यूरोप','जनसंख्या'],
      uk: ['географія','країна','континент','клімат','столиця','річка','гора','африка','азія','європа','населення'],
    }
  },

  // ── LAW — never math ────────────────────────────────────────────────────
  law: {
    allowsMath: false,
    sectionStyle: 'analytical',
    focus: ['articles', 'legal principles', 'jurisprudence', 'cases'],
    kw: {
      fr: ['droit','juridique','loi','article','jurisprudence','tribunal','constitution','code civil','pénal','contrat','procédure','avocat','juge','arrêt'],
      en: ['law','legal','legislation','court','constitution','criminal law','civil law','contract','procedure','attorney','judge','verdict','statute','jurisprudence'],
      es: ['derecho','jurídico','ley','tribunal','constitución','penal','civil','contrato','procedimiento','abogado'],
      de: ['recht','rechtlich','gesetz','verfassung','strafrecht','zivilrecht','vertrag','verfahren','rechtsanwalt'],
      pt: ['direito','jurídico','lei','tribunal','constituição','penal','civil','contrato','processo','advogado'],
      'pt-BR': ['direito','jurídico','lei','tribunal','constituição','penal','civil','contrato','processo'],
      it: ['diritto','giuridico','legge','tribunale','costituzione','penale','civile','contratto','procedura','avvocato'],
      nl: ['recht','juridisch','wet','rechtbank','grondwet','strafrecht','burgerlijk recht','contract','procedure'],
      zh: ['法律','法学','法院','宪法','刑法','民法','合同','诉讼程序','律师','判决'],
      ja: ['法律','法学','裁判所','憲法','刑法','民法','契約','訴訟手続','弁護士','判決'],
      ko: ['법','법학','법원','헌법','형법','민법','계약','소송절차','변호사','판결'],
      id: ['hukum','undang-undang','pengadilan','konstitusi','hukum pidana','hukum perdata','kontrak','prosedur','pengacara'],
      ar: ['قانون','قانوني','محكمة','دستور','القانون الجنائي','القانون المدني','عقد','إجراءات قانونية','محامي'],
      tr: ['hukuk','kanun','mahkeme','anayasa','ceza hukuku','medeni hukuk','sözleşme','prosedür','avukat'],
      th: ['กฎหมาย','ศาล','รัฐธรรมนูญ','กฎหมายอาญา','กฎหมายแพ่ง','สัญญา','ทนายความ','คำพิพากษา'],
      ru: ['право','юридический','закон','суд','конституция','уголовное право','гражданское право','договор','адвокат','приговор'],
      pl: ['prawo','prawny','sąd','konstytucja','prawo karne','prawo cywilne','umowa','procedura','adwokat'],
      vi: ['luật','pháp luật','tòa án','hiến pháp','luật hình sự','luật dân sự','hợp đồng','thủ tục tố tụng','luật sư'],
      hi: ['कानून','कानूनी','न्यायालय','संविधान','दंड कानून','दीवानी कानून','अनुबंध','न्यायाधीश','वकील'],
      uk: ['право','юридичний','закон','суд','конституція','кримінальне право','цивільне право','договір','адвокат'],
    }
  },

  // ── LANGUAGE LEARNING — never math ─────────────────────────────────────
  language_learning: {
    allowsMath: false,
    sectionStyle: 'practical',
    focus: ['grammar rules', 'vocabulary', 'pronunciation', 'usage', 'common mistakes'],
    kw: {
      fr: ['grammaire','conjugaison','vocabulaire','traduction','prononciation','orthographe','syntaxe','langue étrangère','anglais','espagnol','allemand','subjonctif','temps verbaux'],
      en: ['grammar','conjugation','vocabulary','translation','pronunciation','spelling','syntax','foreign language','tenses','subjunctive','language learning'],
      es: ['gramática','conjugación','vocabulario','pronunciación','ortografía','sintaxis','idioma','tiempo verbal'],
      de: ['grammatik','konjugation','vokabular','aussprache','rechtschreibung','syntax','sprache','zeitformen'],
      pt: ['gramática','conjugação','vocabulário','pronúncia','ortografia','sintaxe','língua estrangeira','tempos verbais'],
      'pt-BR': ['gramática','conjugação','vocabulário','pronúncia','ortografia','sintaxe','língua','verbos'],
      it: ['grammatica','coniugazione','vocabolario','pronuncia','ortografia','sintassi','lingua straniera','tempi verbali'],
      nl: ['grammatica','vervoeging','woordenschat','uitspraak','spelling','syntaxis','vreemde taal','werkwoordtijden'],
      zh: ['语法','词汇','发音','拼写','外语','汉语','英语','语法结构','词汇量','语言学习'],
      ja: ['文法','語彙','発音','スペル','外国語','日本語','英語','言語学習','動詞変化'],
      ko: ['문법','어휘','발음','철자','외국어','한국어','영어','언어학습','동사변화'],
      id: ['tata bahasa','kosakata','pengucapan','ejaan','sintaksis','bahasa asing','pembelajaran bahasa'],
      ar: ['نحو','صرف','مفردات','نطق','إملاء','لغة أجنبية','تعلم اللغة','تصريف الأفعال'],
      tr: ['dilbilgisi','kelime bilgisi','telaffuz','yazım','sözdizimi','yabancı dil','dil öğrenimi','çekim'],
      th: ['ไวยากรณ์','คำศัพท์','การออกเสียง','การสะกด','ภาษาต่างประเทศ','การเรียนภาษา','กริยา'],
      ru: ['грамматика','спряжение','словарь','произношение','орфография','синтаксис','иностранный язык','изучение языка'],
      pl: ['gramatyka','koniugacja','słownictwo','wymowa','ortografia','składnia','język obcy','nauka języka'],
      vi: ['ngữ pháp','từ vựng','phát âm','chính tả','cú pháp','ngoại ngữ','học ngôn ngữ','chia động từ'],
      hi: ['व्याकरण','शब्द भंडार','उच्चारण','वर्तनी','वाक्य रचना','विदेशी भाषा','भाषा शिक्षण'],
      uk: ['граматика','відмінювання','словниковий запас','вимова','орфографія','синтаксис','іноземна мова','вивчення мови'],
    }
  },

  // ── MATH — formulas expected ────────────────────────────────────────────
  math: {
    allowsMath: true,
    sectionStyle: 'mathematical',
    focus: ['formulas', 'theorems', 'proofs', 'step-by-step examples'],
    kw: {
      fr: ['mathématiques','maths','dérivée','intégrale','équation','fraction','logarithme','matrice','vecteur','probabilité','statistique','algèbre','géométrie','trigonométrie','polynôme','nombre complexe','suite','limite'],
      en: ['math','maths','mathematics','derivative','integral','equation','fraction','logarithm','matrix','probability','statistics','algebra','geometry','trigonometry','polynomial','complex number','sequence','limit','calculus'],
      es: ['matemáticas','derivada','integral','ecuación','fracción','logaritmo','matriz','probabilidad','estadística','álgebra','geometría','trigonometría','polinomio'],
      de: ['mathematik','mathe','ableitung','integral','gleichung','bruch','logarithmus','matrix','wahrscheinlichkeit','statistik','algebra','geometrie','trigonometrie'],
      pt: ['matemática','derivada','integral','equação','fração','logaritmo','matriz','probabilidade','estatística','álgebra','geometria','trigonometria'],
      'pt-BR': ['matemática','derivada','integral','equação','fração','logaritmo','matriz','probabilidade','álgebra','geometria'],
      it: ['matematica','derivata','integrale','equazione','frazione','logaritmo','matrice','probabilità','statistica','algebra','geometria','trigonometria'],
      nl: ['wiskunde','afgeleide','integraal','vergelijking','breuk','logaritme','matrix','kansrekening','statistiek','algebra','meetkunde','trigonometrie'],
      zh: ['数学','导数','积分','方程','分数','对数','矩阵','向量','概率','统计','代数','几何','三角','多项式'],
      ja: ['数学','微分','積分','方程式','分数','対数','行列','ベクトル','確率','統計','代数','幾何','三角関数'],
      ko: ['수학','미분','적분','방정식','분수','로그','행렬','벡터','확률','통계','대수','기하','삼각함수'],
      id: ['matematika','turunan','integral','persamaan','pecahan','logaritma','matriks','probabilitas','statistika','aljabar','geometri','trigonometri'],
      ar: ['رياضيات','مشتقة','تكامل','معادلة','كسر','لوغاريتم','مصفوفة','احتمال','إحصاء','جبر','هندسة','مثلثات'],
      tr: ['matematik','türev','integral','denklem','kesir','logaritma','matris','olasılık','istatistik','cebir','geometri','trigonometri'],
      th: ['คณิตศาสตร์','อนุพันธ์','อินทิกรัล','สมการ','เศษส่วน','ลอการิทึม','เมทริกซ์','ความน่าจะเป็น','สถิติ','พีชคณิต','เรขาคณิต'],
      ru: ['математика','производная','интеграл','уравнение','дробь','логарифм','матрица','вероятность','статистика','алгебра','геометрия','тригонометрия'],
      pl: ['matematyka','pochodna','całka','równanie','ułamek','logarytm','macierz','prawdopodobieństwo','statystyka','algebra','geometria','trygonometria'],
      vi: ['toán học','đạo hàm','tích phân','phương trình','phân số','logarit','ma trận','xác suất','thống kê','đại số','hình học','lượng giác'],
      hi: ['गणित','अवकलज','समाकलन','समीकरण','भिन्न','लॉगरिदम','आव्यूह','प्रायिकता','सांख्यिकी','बीजगणित','ज्यामिति','त्रिकोणमिति'],
      uk: ['математика','похідна','інтеграл','рівняння','дріб','логарифм','матриця','ймовірність','статистика','алгебра','геометрія','тригонометрія'],
    }
  },

  // ── PHYSICS — formulas expected ─────────────────────────────────────────
  physics: {
    allowsMath: true,
    sectionStyle: 'scientific',
    focus: ['laws', 'formulas', 'experiments', 'calculations'],
    kw: {
      fr: ['physique','mécanique','thermodynamique','optique','électricité','magnétisme','newton','einstein','cinématique','dynamique','onde','quantique','relativité','énergie','force'],
      en: ['physics','mechanics','thermodynamics','optics','electricity','magnetism','newton','einstein','kinematics','dynamics','wave','quantum','relativity','energy','force'],
      es: ['física','mecánica','termodinámica','óptica','electricidad','magnetismo','newton','einstein','cinemática','onda','relatividad'],
      de: ['physik','mechanik','thermodynamik','optik','elektrizität','magnetismus','newton','einstein','kinematik','welle','relativität'],
      pt: ['física','mecânica','termodinâmica','óptica','eletricidade','magnetismo','newton','einstein','relatividade','energia','onda'],
      'pt-BR': ['física','mecânica','termodinâmica','óptica','eletricidade','magnetismo','newton','einstein'],
      it: ['fisica','meccanica','termodinamica','ottica','elettricità','magnetismo','newton','einstein','cinematica','onde','relatività'],
      nl: ['fysica','mechanica','thermodynamica','optica','elektriciteit','magnetisme','newton','einstein','kinematica','golven','relativiteit'],
      zh: ['物理','力学','热力学','光学','电学','磁学','牛顿','爱因斯坦','运动学','波','量子','相对论','能量','力'],
      ja: ['物理','力学','熱力学','光学','電気','磁気','ニュートン','アインシュタイン','運動学','波','量子','相対性'],
      ko: ['물리','역학','열역학','광학','전기','자기','뉴턴','아인슈타인','운동학','파동','양자','상대성'],
      id: ['fisika','mekanika','termodinamika','optika','listrik','magnetisme','newton','einstein','kinematika','gelombang','relativitas'],
      ar: ['فيزياء','ميكانيكا','ديناميكا حرارية','بصريات','كهرباء','مغناطيسية','نيوتن','أينشتاين','كينماتيكا','موجات','نسبية'],
      tr: ['fizik','mekanik','termodinamik','optik','elektrik','manyetizma','newton','einstein','kinematik','dalgalar','görelilik'],
      th: ['ฟิสิกส์','กลศาสตร์','อุณหพลศาสตร์','แสงศาสตร์','ไฟฟ้า','แม่เหล็ก','นิวตัน','ไอน์สไตน์','คลื่น','ควอนตัม'],
      ru: ['физика','механика','термодинамика','оптика','электричество','магнетизм','ньютон','эйнштейн','кинематика','волны','квантовая','релятивизм'],
      pl: ['fizyka','mechanika','termodynamika','optyka','elektryczność','magnetyzm','newton','einstein','kinematyka','fale','kwantowa','teoria względności'],
      vi: ['vật lý','cơ học','nhiệt động lực học','quang học','điện học','từ học','newton','einstein','động học','sóng','lượng tử','tương đối'],
      hi: ['भौतिकी','यांत्रिकी','ऊष्मागतिकी','प्रकाशिकी','विद्युत','चुंबकत्व','न्यूटन','आइंस्टीन','गतिकी','तरंग','क्वांटम'],
      uk: ['фізика','механіка','термодинаміка','оптика','електрика','магнетизм','ньютон','ейнштейн','кінематика','хвилі','квантова','теорія відносності'],
    }
  },

  // ── CHEMISTRY — formulas expected ───────────────────────────────────────
  chemistry: {
    allowsMath: true,
    sectionStyle: 'scientific',
    focus: ['equations', 'reactions', 'elements', 'mechanisms'],
    kw: {
      fr: ['chimie','molécule','atome','réaction chimique','équilibre','organique','inorganique','tableau périodique','oxydation','acide','base','liaison','stœchiométrie'],
      en: ['chemistry','molecule','atom','chemical reaction','equilibrium','organic','inorganic','periodic table','oxidation','acid','base','bond','stoichiometry'],
      es: ['química','molécula','átomo','reacción química','equilibrio','orgánica','inorgánica','tabla periódica','ácido','base','enlace'],
      de: ['chemie','molekül','atom','chemische reaktion','gleichgewicht','organisch','anorganisch','periodensystem','säure','base','bindung'],
      pt: ['química','molécula','átomo','reação química','equilíbrio','orgânica','inorgânica','tabela periódica','ácido','base'],
      'pt-BR': ['química','molécula','átomo','reação química','equilíbrio','orgânica','inorgânica','tabela periódica'],
      it: ['chimica','molecola','atomo','reazione chimica','equilibrio','organica','inorganica','tavola periodica','acido','base'],
      nl: ['scheikunde','molecuul','atoom','chemische reactie','evenwicht','organisch','anorganisch','periodiek systeem','zuur','base'],
      zh: ['化学','分子','原子','化学反应','平衡','有机','无机','元素周期表','氧化还原','酸','碱','化学键'],
      ja: ['化学','分子','原子','化学反応','平衡','有機','無機','周期表','酸化還元','酸','塩基','化学結合'],
      ko: ['화학','분자','원자','화학반응','평형','유기','무기','주기율표','산화환원','산','염기'],
      id: ['kimia','molekul','atom','reaksi kimia','kesetimbangan','organik','anorganik','tabel periodik','asam','basa','ikatan kimia'],
      ar: ['كيمياء','جزيء','ذرة','تفاعل كيميائي','توازن','عضوية','غير عضوية','جدول دوري','أكسدة','حمض','قاعدة'],
      tr: ['kimya','molekül','atom','kimyasal reaksiyon','denge','organik','inorganik','periyodik tablo','asit','baz','kimyasal bağ'],
      th: ['เคมี','โมเลกุล','อะตอม','ปฏิกิริยาเคมี','สมดุล','อินทรีย์','อนินทรีย์','ตารางธาตุ','กรด','เบส'],
      ru: ['химия','молекула','атом','химическая реакция','равновесие','органика','неорганика','таблица менделеева','кислота','основание','химическая связь'],
      pl: ['chemia','cząsteczka','atom','reakcja chemiczna','równowaga','organiczna','nieorganiczna','układ okresowy','kwas','zasada'],
      vi: ['hóa học','phân tử','nguyên tử','phản ứng hóa học','cân bằng','hữu cơ','vô cơ','bảng tuần hoàn','axit','bazơ'],
      hi: ['रसायन','अणु','परमाणु','रासायनिक अभिक्रिया','साम्यावस्था','कार्बनिक','अकार्बनिक','आवर्त सारणी','अम्ल','क्षार'],
      uk: ['хімія','молекула','атом','хімічна реакція','рівновага','органіка','неорганіка','таблиця менделєєва','кислота','основа'],
    }
  },

  // ── BIOLOGY — no advanced math ──────────────────────────────────────────
  biology: {
    allowsMath: false,
    sectionStyle: 'scientific',
    focus: ['concepts', 'processes', 'structures', 'biological systems'],
    kw: {
      fr: ['biologie','anatomie','cellule','adn','génétique','physiologie','écosystème','évolution','photosynthèse','métabolisme','mitose','méiose','écologie','immunité','organisme'],
      en: ['biology','anatomy','cell','dna','genetics','physiology','ecosystem','evolution','photosynthesis','metabolism','mitosis','meiosis','ecology','immunity','organism'],
      es: ['biología','anatomía','célula','adn','genética','fisiología','ecosistema','evolución','fotosíntesis','metabolismo','ecología'],
      de: ['biologie','anatomie','zelle','dna','genetik','physiologie','ökosystem','evolution','fotosynthese','stoffwechsel','ökologie'],
      pt: ['biologia','anatomia','célula','adn','genética','fisiologia','ecossistema','evolução','fotossíntese','metabolismo'],
      'pt-BR': ['biologia','anatomia','célula','adn','genética','fisiologia','ecossistema','evolução','fotossíntese'],
      it: ['biologia','anatomia','cellula','dna','genetica','fisiologia','ecosistema','evoluzione','fotosintesi','metabolismo'],
      nl: ['biologie','anatomie','cel','dna','genetica','fysiologie','ecosysteem','evolutie','fotosynthese','metabolisme'],
      zh: ['生物','解剖','细胞','基因','遗传学','生理','生态系统','进化','光合作用','新陈代谢','有丝分裂','减数分裂'],
      ja: ['生物','解剖','細胞','DNA','遺伝学','生理','生態系','進化','光合成','代謝','有糸分裂'],
      ko: ['생물','해부','세포','dna','유전학','생리','생태계','진화','광합성','대사'],
      id: ['biologi','anatomi','sel','dna','genetika','fisiologi','ekosistem','evolusi','fotosintesis','metabolisme'],
      ar: ['أحياء','تشريح','خلية','دنا','علم الجينات','فيزيولوجيا','نظام بيئي','تطور','التمثيل الضوئي','التمثيل الغذائي'],
      tr: ['biyoloji','anatomi','hücre','dna','genetik','fizyoloji','ekosistem','evrim','fotosentez','metabolizma'],
      th: ['ชีววิทยา','กายวิภาค','เซลล์','ดีเอ็นเอ','พันธุศาสตร์','สรีรวิทยา','ระบบนิเวศ','วิวัฒนาการ','การสังเคราะห์แสง'],
      ru: ['биология','анатомия','клетка','днк','генетика','физиология','экосистема','эволюция','фотосинтез','метаболизм'],
      pl: ['biologia','anatomia','komórka','dna','genetyka','fizjologia','ekosystem','ewolucja','fotosynteza','metabolizm'],
      vi: ['sinh học','giải phẫu','tế bào','adn','di truyền học','sinh lý','hệ sinh thái','tiến hóa','quang hợp','trao đổi chất'],
      hi: ['जीव विज्ञान','शरीर रचना','कोशिका','डीएनए','आनुवंशिकी','शरीर क्रिया','पारिस्थितिकी तंत्र','विकास','प्रकाश संश्लेषण'],
      uk: ['біологія','анатомія','клітина','днк','генетика','фізіологія','екосистема','еволюція','фотосинтез','метаболізм'],
    }
  },

  // ── ECONOMICS — light stats OK ──────────────────────────────────────────
  economics: {
    allowsMath: false,
    sectionStyle: 'analytical',
    focus: ['concepts', 'theories', 'real-world examples', 'data interpretation'],
    kw: {
      fr: ['économie','finance','marché','inflation','pib','macroéconomie','microéconomie','offre','demande','croissance','récession','commerce international','keynes','smith','capitalisme'],
      en: ['economics','finance','market','inflation','gdp','macroeconomics','microeconomics','supply','demand','growth','recession','trade','keynes','smith','capitalism'],
      es: ['economía','finanzas','mercado','inflación','pib','macroeconomía','microeconomía','oferta','demanda','crecimiento','recesión','comercio'],
      de: ['wirtschaft','finanzen','markt','inflation','bip','makroökonomie','mikroökonomie','angebot','nachfrage','wachstum','rezession','handel'],
      pt: ['economia','finanças','mercado','inflação','pib','macroeconomia','microeconomia','oferta','procura','crescimento','recessão','comércio'],
      'pt-BR': ['economia','finanças','mercado','inflação','pib','macroeconomia','microeconomia','oferta','demanda'],
      it: ['economia','finanza','mercato','inflazione','pil','macroeconomia','microeconomia','offerta','domanda','crescita','recessione'],
      nl: ['economie','financiën','markt','inflatie','bbp','macro-economie','micro-economie','vraag','aanbod','groei','recessie','handel'],
      zh: ['经济','金融','市场','通胀','gdp','宏观经济','微观经济','供求','增长','衰退','贸易','凯恩斯','资本主义'],
      ja: ['経済','金融','市場','インフレ','gdp','マクロ経済','ミクロ経済','需給','成長','不況','貿易','ケインズ'],
      ko: ['경제','금융','시장','인플레이션','gdp','거시경제','미시경제','공급과 수요','성장','침체','무역'],
      id: ['ekonomi','keuangan','pasar','inflasi','pdb','makroekonomi','mikroekonomi','penawaran','permintaan','pertumbuhan','resesi'],
      ar: ['اقتصاد','مالية','سوق','تضخم','الناتج المحلي','اقتصاد كلي','اقتصاد جزئي','عرض وطلب','نمو','ركود','تجارة'],
      tr: ['ekonomi','finans','pazar','enflasyon','gsyh','makroekonomi','mikroekonomi','arz ve talep','büyüme','resesyon','ticaret'],
      th: ['เศรษฐกิจ','การเงิน','ตลาด','เงินเฟ้อ','gdp','เศรษฐศาสตร์มหภาค','เศรษฐศาสตร์จุลภาค','อุปสงค์อุปทาน','การเติบโต','ภาวะถดถอย'],
      ru: ['экономика','финансы','рынок','инфляция','ввп','макроэкономика','микроэкономика','спрос','предложение','рост','рецессия','торговля'],
      pl: ['ekonomia','finanse','rynek','inflacja','pkb','makroekonomia','mikroekonomia','popyt','podaż','wzrost','recesja','handel'],
      vi: ['kinh tế','tài chính','thị trường','lạm phát','gdp','kinh tế vĩ mô','kinh tế vi mô','cung cầu','tăng trưởng','suy thoái'],
      hi: ['अर्थशास्त्र','वित्त','बाजार','मुद्रास्फीति','जीडीपी','समष्टि अर्थशास्त्र','व्यष्टि अर्थशास्त्र','आपूर्ति और मांग','विकास'],
      uk: ['економіка','фінанси','ринок','інфляція','ввп','макроекономіка','мікроекономіка','попит','пропозиція','зростання','рецесія'],
    }
  },

  // ── COMPUTER SCIENCE — code OK ──────────────────────────────────────────
  computer_science: {
    allowsMath: true,
    sectionStyle: 'technical',
    focus: ['concepts', 'algorithms', 'code examples', 'applications'],
    kw: {
      fr: ['informatique','programmation','algorithme','python','javascript','java','code','développement','structure de données','réseau','base de données','intelligence artificielle','machine learning'],
      en: ['computer science','programming','algorithm','python','javascript','java','coding','software','data structure','network','database','artificial intelligence','machine learning'],
      es: ['informática','programación','algoritmo','python','javascript','java','código','software','estructura de datos','red','base de datos'],
      de: ['informatik','programmierung','algorithmus','python','javascript','java','code','software','datenstruktur','netzwerk','datenbank'],
      pt: ['informática','programação','algoritmo','python','javascript','java','código','software','estrutura de dados','rede','banco de dados'],
      'pt-BR': ['informática','programação','algoritmo','python','javascript','java','código','software','banco de dados'],
      it: ['informatica','programmazione','algoritmo','python','javascript','java','codice','software','struttura dati','rete','database'],
      nl: ['informatica','programmering','algoritme','python','javascript','java','code','software','datastructuur','netwerk','database'],
      zh: ['计算机','编程','算法','python','javascript','java','代码','软件','数据结构','网络','数据库','人工智能','机器学习'],
      ja: ['コンピュータ','プログラミング','アルゴリズム','python','javascript','java','コード','ソフトウェア','データ構造','ネットワーク','データベース'],
      ko: ['컴퓨터','프로그래밍','알고리즘','파이썬','자바스크립트','자바','코드','소프트웨어','자료구조','네트워크','데이터베이스'],
      id: ['informatika','pemrograman','algoritma','python','javascript','java','kode','perangkat lunak','struktur data','jaringan','basis data'],
      ar: ['علوم الكمبيوتر','برمجة','خوارزمية','بايثون','جافاسكريبت','جافا','كود','برمجيات','بنية بيانات','شبكة','قاعدة بيانات'],
      tr: ['bilgisayar bilimi','programlama','algoritma','python','javascript','java','kod','yazılım','veri yapısı','ağ','veritabanı'],
      th: ['คอมพิวเตอร์','การเขียนโปรแกรม','อัลกอริทึม','ไพธอน','จาวาสคริปต์','จาวา','โค้ด','ซอฟต์แวร์','โครงสร้างข้อมูล'],
      ru: ['информатика','программирование','алгоритм','python','javascript','java','код','программное обеспечение','структуры данных','сеть','база данных'],
      pl: ['informatyka','programowanie','algorytm','python','javascript','java','kod','oprogramowanie','struktura danych','sieć','baza danych'],
      vi: ['tin học','lập trình','thuật toán','python','javascript','java','mã lập trình','phần mềm','cấu trúc dữ liệu','mạng','cơ sở dữ liệu'],
      hi: ['कंप्यूटर विज्ञान','प्रोग्रामिंग','एल्गोरिदम','पायथन','जावास्क्रिप्ट','जावा','कोड','सॉफ्टवेयर','डेटा संरचना'],
      uk: ['інформатика','програмування','алгоритм','python','javascript','java','код','програмне забезпечення','структури даних','мережа','база даних'],
    }
  },
};

// ── detectSubject ────────────────────────────────────────────────────────────
function detectSubject(text, lang) {
  const lower = text.toLowerCase();
  const scores = {};

  for (const [cat, cfg] of Object.entries(SUBJECTS)) {
    scores[cat] = 0;
    for (const [l, kws] of Object.entries(cfg.kw)) {
      const isUserLang = l === lang;
      for (const kw of kws) {
        if (lower.includes(kw.toLowerCase())) {
          // Longer keyword → more specific → more weight
          const lenBonus = kw.length >= 8 ? 3 : kw.length >= 5 ? 2 : 1;
          // Keyword in user's language → stronger signal
          const langBonus = isUserLang ? 3 : 1;
          scores[cat] += lenBonus * langBonus;
        }
      }
    }
  }

  const ranked = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const [topCat, topScore] = ranked[0];

  if (topScore === 0) {
    return { category: 'general', allowsMath: null, sectionStyle: 'general', focus: [], confidence: 0 };
  }
  const cfg = SUBJECTS[topCat];
  return {
    category: topCat,
    allowsMath: cfg.allowsMath,
    sectionStyle: cfg.sectionStyle,
    focus: cfg.focus,
    confidence: topScore,
  };
}

module.exports = { detectSubject, SUBJECTS };
