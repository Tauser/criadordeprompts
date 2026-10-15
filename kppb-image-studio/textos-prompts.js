// Versão 3: anatomia concisa e conflitos resolvidos antes do envio.
// Textos editáveis dos presets, expansões NSFW completas e da composição do prompt.
// Os pares [EN, PT] existentes foram preservados; o prompt ativo usa somente EN.
// Mantenha este arquivo junto do HTML. Não altere nomes das chaves.

const dict = {
  subjects: {
    woman: [
      "one fictional adult woman, visibly aged 25 or older",
      "uma mulher adulta fictícia, visivelmente com 25 anos ou mais",
    ],
    man: [
      "one fictional adult man, visibly aged 25 or older",
      "um homem adulto fictício, visivelmente com 25 anos ou mais",
    ],
    two: [
      "two fictional consenting adults, both visibly aged 25 or older",
      "dois adultos fictícios consentindo, ambos visivelmente com 25 anos ou mais",
    ],
    custom: [
      "fictional adult characters, aged 25 or older",
      "personagens adultos fictícios, com 25 anos ou mais",
    ],
  },
  ages: {
    adult: [
      "adult facial features and proportions",
      "traços faciais e proporções adultas",
    ],
    mature: [
      "mature adult features, aged over 40",
      "traços de adultos maduros, acima de 40 anos",
    ],
    senior: [
      "older adult features, aged over 60",
      "traços de pessoas adultas mais velhas, acima de 60 anos",
    ],
  },
  env: {
    loft: [
      "a refined contemporary apartment with clean architecture",
      "um apartamento contemporâneo elegante e de arquitetura limpa",
    ],
    studio: [
      "a minimal professional photography studio",
      "um estúdio fotográfico profissional e minimalista",
    ],
    bedroom: [
      "an elegant bedroom with soft neutral decor",
      "um quarto elegante com decoração suave e neutra",
    ],
    street: [
      "a realistic urban street with natural depth",
      "uma rua urbana realista com profundidade natural",
    ],
    nature: [
      "a lush garden with natural details",
      "um jardim exuberante com detalhes naturais",
    ],
    neutral: [
      "a seamless neutral studio backdrop",
      "um fundo neutro e contínuo de estúdio",
    ],
    beach: [
      "a beach with pale sand, ocean waves and a visible horizon",
      "uma praia com areia clara, ondas do mar e horizonte visível",
    ],
    terrace: [
      "a rooftop terrace with glass railings and a city skyline",
      "um terraço com guarda-corpo de vidro e prédios da cidade ao fundo",
    ],
    pool: [
      "an outdoor swimming pool with blue water, tiled edges and sun loungers",
      "uma piscina externa com água azul, bordas de azulejo e espreguiçadeiras",
    ],
    library: [
      "a library with tall wooden bookshelves, books and reading tables",
      "uma biblioteca com estantes altas de madeira, livros e mesas de leitura",
    ],
    kitchen: [
      "a modern kitchen with white cabinets, a stone countertop and pendant lights",
      "uma cozinha moderna com armários brancos, bancada de pedra e luminárias pendentes",
    ],
    forest: [
      "a forest with tall trees, green foliage and a visible earth trail",
      "uma floresta com árvores altas, folhagem verde e trilha de terra visível",
    ],
    hotel: [
      "a hotel room with a made bed, upholstered headboard and a large window",
      "um quarto de hotel com cama arrumada, cabeceira estofada e janela ampla",
    ],
    raincity: [
      "a rainy city street with wet pavement, storefronts and reflected lights",
      "uma rua urbana na chuva com calçada molhada, lojas e luzes refletidas",
    ],
    brickstudio: [
      "a photography studio with an exposed brick wall and a wooden floor",
      "um estúdio fotográfico com parede de tijolos aparentes e piso de madeira",
    ],
    dressing: [
      "a dressing room with a lighted mirror, clothing racks and a padded stool",
      "um camarim com espelho iluminado, araras de roupas e banco estofado",
    ],
    custom: [
      "the environment specified in the custom instruction",
      "o ambiente especificado na instrução personalizada",
    ],
  },
  wardrobe: {
    elegant: [
      "a beige tailored blazer over an ivory blouse with dark straight-leg trousers",
      "um blazer bege de alfaiataria sobre uma blusa marfim e calça escura de corte reto",
    ],
    casual: [
      "a white cotton T-shirt and blue straight-leg jeans",
      "uma camiseta branca de algodão e jeans azul de corte reto",
    ],
    formal: [
      "a navy tailored suit with a white dress shirt",
      "um terno azul-marinho de alfaiataria com camisa social branca",
    ],
    sports: [
      "an opaque athletic top and black jogger trousers",
      "uma camiseta esportiva opaca e calça jogger preta",
    ],
    evening: [
      "a floor-length burgundy satin evening dress",
      "um vestido longo de festa em cetim vinho",
    ],
    blackdress: [
      "a fitted black midi dress with thin shoulder straps and opaque fabric",
      "um vestido midi preto ajustado com alças finas e tecido opaco",
    ],
    linen: [
      "a loose white linen shirt and beige linen trousers",
      "uma camisa branca solta de linho e calça bege de linho",
    ],
    denim: [
      "a blue denim jacket over a white T-shirt with black trousers",
      "uma jaqueta jeans azul sobre camiseta branca e calça preta",
    ],
    skirt: [
      "an ivory blouse and a knee-length black pleated skirt",
      "uma blusa marfim e saia preta plissada na altura dos joelhos",
    ],
    leather: [
      "a black leather jacket over a plain grey T-shirt with dark jeans",
      "uma jaqueta de couro preta sobre camiseta lisa cinza e jeans escuro",
    ],
    sweater: [
      "a cream knit sweater with charcoal tailored trousers",
      "um suéter de tricô creme com calça de alfaiataria cinza-escura",
    ],
    swimwear: [
      "adult swimwear suited to the scene",
      "roupa de banho adulta adequada à cena",
    ],
    lingerie_lace: [
      "an elegant lace lingerie set with realistic fabric details",
      "um conjunto elegante de lingerie de renda com detalhes realistas do tecido",
    ],
    lingerie_satin: [
      "a matching satin lingerie set with realistic sheen and stitching",
      "um conjunto de lingerie de cetim com brilho e costura realistas",
    ],
    lingerie_bodysuit: [
      "a refined one-piece lingerie bodysuit with natural fabric tension",
      "um body de lingerie refinado, com tensão natural do tecido",
    ],
    lingerie_silk: [
      "a soft silk slip dress with realistic flowing fabric",
      "uma camisola de seda macia, com tecido fluido realista",
    ],
    lingerie_minimal: [
      "minimalist coordinated adult lingerie with natural fit",
      "lingerie adulta minimalista e coordenada, com caimento natural",
    ],
    robe: [
      "a loosely draped elegant silk robe with natural fabric folds",
      "um robe elegante de seda com pregas naturais",
    ],
    figure_study: [
      "fine-art nude figure study of a fully fictional adult; discreet composition with explicit intimate anatomical detail",
      "um estudo de figura em nu artístico de adulto inteiramente fictício",
    ],
    custom: [
      "the outfit described in the custom instruction",
      "a roupa descrita na instrução personalizada",
    ],
  },
  sensualPoses: {
    "arched back on all fours": [
      "on all fours with back deeply arched, ass raised high, face down",
      "de mãos e joelhos, com costas profundamente arqueadas, quadril elevado e rosto para baixo",
    ],
    "ass up face down": [
      "face pressed down with ass raised high in the air, back arched",
      "rosto pressionado para baixo com o quadril elevado no ar e costas arqueadas",
    ],
    "back arched standing": [
      "standing with back deeply arched pushing chest forward and ass out",
      "em pé com as costas arqueadas empurrando o peito para a frente",
    ],
    "bent over": [
      "bent over at the waist, ass presented, upper body lowered",
      "inclinado à frente pela cintura, quadril apresentado e tronco abaixado",
    ],
    "bent over looking back": [
      "bent over at the waist looking back over shoulder, ass prominently displayed",
      "inclinado à frente pela cintura olhando para trás por cima do ombro",
    ],
    "chest pressed together arms": [
      "upper arms squeezing breasts together from the outside, pushing them up and forward, deepening cleavage",
      "braços apertando os seios juntos a partir do exterior, aprofundando o decote",
    ],
    "hands and knees": [
      "on hands and knees, back slightly arched",
      "de mãos e joelhos, com as costas levemente arqueadas",
    ],
    "kneeling legs apart": [
      "kneeling with knees spread wide apart",
      "ajoelhado com os joelhos bem afastados",
    ],
    "kneeling looking up": [
      "kneeling on the floor looking up with lips slightly parted",
      "ajoelhado no chão olhando para cima com lábios entreabertos",
    ],
    "legs open seated": [
      "sitting with legs spread wide open",
      "sentado com as pernas bem afastadas",
    ],
    "legs spread lying back": [
      "lying on back with legs spread wide open",
      "deitado de costas com as pernas bem abertas",
    ],
    "legs up lying back": [
      "lying on back with both legs raised up in the air",
      "deitado de costas com ambas as pernas erguidas no ar",
    ],
    "lying face down hips raised": [
      "lying face down with hips and ass raised up off the surface",
      "deitado de bruços com o quadril elevado da superfície",
    ],
    "lying on back knees bent": [
      "lying on back with knees bent and pulled toward chest",
      "deitado de costas com joelhos flexionados junto ao peito",
    ],
    "lying on side leg raised": [
      "lying on side with top leg raised high, exposing inner thigh",
      "deitado de lado com a perna superior elevada, expondo a coxa",
    ],
    "on elbows and knees": [
      "on elbows and knees with ass raised high, face near the ground",
      "sobre antebraços e joelhos com o quadril elevado e rosto rente ao chão",
    ],
    "on knees back arched": [
      "on knees with back deeply arched, chest pushed forward",
      "de joelhos com costas profundamente arqueadas e peito para a frente",
    ],
    "on knees hands on thighs": [
      "on knees with hands resting on spread thighs",
      "de joelhos com as mãos apoiadas nas coxas afastadas",
    ],
    "one leg up against wall": [
      "standing with one leg raised up against wall, exposing inner thigh",
      "em pé com uma perna elevada contra a parede",
    ],
    "presenting from behind": [
      "on all fours with ass raised and presented toward camera, back arched, looking back over shoulder",
      "de quatro com o quadril elevado para a câmera, costas arqueadas, olhando para trás",
    ],
    "reclining legs parted": [
      "reclining back with legs parted and relaxed open",
      "reclinado com as pernas entreabertas e relaxadas",
    ],
    "riding position": [
      "straddling position with hips thrust forward as if riding",
      "posição de montaria com o quadril projetado para a frente",
    ],
    "sitting legs open": [
      "sitting with legs spread wide open",
      "sentado com as pernas bem abertas",
    ],
    "sitting spread eagle": [
      "sitting with legs fully spread eagle, wide open",
      "sentado com as pernas completamente abertas e afastadas",
    ],
    "squatting legs apart": [
      "squatting down with knees spread wide apart",
      "agachado com os joelhos bem afastados",
    ],
    "standing bent at waist": [
      "standing and bent forward at the waist, ass pushed back",
      "em pé e inclinado para a frente pela cintura",
    ],
    "standing legs apart": [
      "standing with legs spread wide apart",
      "em pé com as pernas afastadas",
    ],
    straddling: [
      "straddling with legs on either side, hips lowered",
      "montado com uma perna de cada lado e quadril abaixado",
    ],
    "stretching on bed": [
      "stretching body across bed with limbs extended, body elongated",
      "alongando o corpo na cama com membros estendidos",
    ],
    "topless covering with hands": [
      "topless with hands cupping and covering bare breasts",
      "sem parte de cima, cobrindo os seios com as mãos",
    ],
    "topless hair covering": [
      "topless with long hair draped over and partially covering bare breasts",
      "sem parte de cima, com cabelos longos cobrindo parcialmente os seios",
    ],
  },
  poses: {
    neutral: [
      "standing naturally, with relaxed shoulders and balanced weight",
      "em pé naturalmente, ombros relaxados e peso bem distribuído",
    ],
    seated: [
      "sitting comfortably with anatomically plausible posture",
      "sentado confortavelmente com postura anatomicamente plausível",
    ],
    kneeling: [
      "kneeling upright, with knees supporting body weight and torso naturally aligned",
      "ajoelhado com o tronco alinhado naturalmente e o peso apoiado nos joelhos",
    ],
    lookback: [
      "turning the upper torso slightly and looking over one shoulder",
      "girando levemente o tronco e olhando por cima do ombro",
    ],
    walking: [
      "walking at a relaxed pace with a natural stride",
      "caminhando tranquilamente com passos naturais",
    ],
    recline: [
      "reclining naturally on a sofa, with the body comfortably supported",
      "reclinando naturalmente em um sofá, com o corpo apoiado",
    ],
    handsknees: [
      "on hands and knees, with balanced support points and natural alignment",
      "com mãos e joelhos apoiados, pontos de apoio equilibrados e alinhamento natural",
    ],
    side: [
      "lying on one side, legs naturally arranged and shoulders supported",
      "deitado de lado, pernas posicionadas naturalmente e ombros apoiados",
    ],
    walllean: [
      "standing with the upper back resting against a wall, one knee softly bent and hands relaxed at the sides",
      "em pé com a parte superior das costas apoiada na parede, um joelho levemente flexionado e mãos relaxadas ao lado do corpo",
    ],
    chairside: [
      "sitting sideways on a chair, both feet on the floor, torso turned gently toward the camera and one hand on the backrest",
      "sentado de lado em uma cadeira, pés no chão, tronco voltado suavemente à câmera e uma mão no encosto",
    ],
    ankles: [
      "sitting upright on a chair with ankles crossed, knees aligned and hands resting on the thighs",
      "sentado ereto em uma cadeira, tornozelos cruzados, joelhos alinhados e mãos nas coxas",
    ],
    sofaarm: [
      "sitting near the end of a sofa, one elbow on the armrest, feet on the floor and torso upright",
      "sentado junto à extremidade do sofá, um cotovelo no braço do sofá, pés no chão e tronco ereto",
    ],
    bededge: [
      "sitting on the edge of a bed with feet on the floor, knees aligned and hands beside the hips",
      "sentado na borda da cama, pés no chão, joelhos alinhados e mãos ao lado dos quadris",
    ],
    hiphand: [
      "standing with weight on one leg, the other knee relaxed, one hand on the hip and shoulders turned slightly toward the camera",
      "em pé com peso em uma perna, outro joelho relaxado, uma mão na cintura e ombros ligeiramente voltados à câmera",
    ],
    armsup: [
      "standing upright with both hands resting behind the head, elbows pointing outward and shoulders relaxed",
      "em pé com as duas mãos atrás da cabeça, cotovelos para os lados e ombros relaxados",
    ],
    seatedcross: [
      "sitting on a chair with one leg crossed over the other at the knee, torso upright and hands on the upper knee",
      "sentado em uma cadeira com uma perna cruzada sobre a outra na altura do joelho, tronco ereto e mãos no joelho superior",
    ],
    floorseated: [
      "sitting on the floor with legs crossed, spine upright and hands on the knees",
      "sentado no chão com pernas cruzadas, coluna ereta e mãos nos joelhos",
    ],
    custom: [
      "using the pose specified in the custom instruction",
      "adotando a pose definida na instrução personalizada",
    ],
  },
  sensualActions: {
    "arching back in pleasure": [
      "arching back with eyes closed and mouth slightly open in pleasure",
      "arqueando as costas com os olhos fechados e boca ligeiramente aberta de prazer",
    ],
    "biting finger": [
      "biting index finger seductively while looking at camera",
      "mordendo o dedo indicador de forma sedutora enquanto olha para a câmera",
    ],
    "biting lip": [
      "biting lower lip seductively",
      "mordendo o lábio inferior de forma sedutora",
    ],
    "caressing inner thigh": [
      "hand slowly caressing up the inner thigh",
      "mão a acariciar lentamente a parte interna da coxa",
    ],
    "cupping breasts": [
      "both hands cupping and squeezing breasts together",
      "ambas as mãos a segurar e apertar os seios juntos",
    ],
    "dripping wet from shower": [
      "skin glistening wet with water dripping down body fresh from shower",
      "pele molhada e brilhante com água a pingar, fresca do duche",
    ],
    "finger in mouth": [
      "finger inserted in mouth, lips wrapped around it suggestively",
      "dedo na boca, com os lábios à volta de forma sugestiva",
    ],
    "grabbing bedsheets": [
      "hands gripping and clutching the bedsheets tightly",
      "mãos a agarrar e apertar os lençóis com força",
    ],
    "grinding on pillow": [
      "straddling a pillow and grinding hips against it",
      "montado numa almofada a esfregar o quadril contra ela",
    ],
    "hands between legs": [
      "one hand reaching down between spread legs",
      "uma mão a alcançar o espaço entre as pernas abertas",
    ],
    "holding vibrator": [
      "holding a vibrator in hand near body",
      "a segurar um vibrador na mão junto ao corpo",
    ],
    "licking finger": [
      "tongue slowly licking finger tip",
      "língua a lamber lentamente a ponta do dedo",
    ],
    "licking lollipop": [
      "tongue licking a lollipop suggestively",
      "língua a lamber um chupa-chupa de forma sugestiva",
    ],
    "looking over shoulder seductively": [
      "looking back over bare shoulder with seductive half-lidded eyes",
      "olhando para trás por cima do ombro nu com olhar sedutor",
    ],
    "moaning expression": [
      "head tilted back, mouth open, eyes closed in ecstasy",
      "cabeça para trás, boca aberta, olhos fechados em êxtase",
    ],
    "oil dripping on body": [
      "glistening body oil being dripped onto skin, body shining wet",
      "óleo corporal brilhante a pingar na pele",
    ],
    "peeling off shirt": [
      "pulling shirt up and off over head, midriff exposed",
      "a puxar a camisa para cima e para fora pela cabeça",
    ],
    "playing with waistband": [
      "fingers hooked in waistband, tugging it down slightly",
      "dedos enganchados no cós, puxando-o levemente para baixo",
    ],
    "pulling down strap": [
      "pulling a bra or top strap down off the shoulder",
      "a puxar a alça do sutiã ou top para fora do ombro",
    ],
    "pulling hair back": [
      "both hands pulling hair back behind head, body stretched and exposed",
      "ambas as mãos a puxar o cabelo para trás",
    ],
    "pulling panties aside": [
      "fingers pulling panties to the side",
      "dedos a puxar as cuecas para o lado",
    ],
    "rubbing lotion on legs": [
      "hands rubbing lotion slowly up along legs and thighs",
      "mãos a espalhar loção lentamente pelas pernas e coxas",
    ],
    "running hands through hair": [
      "running both hands up through hair sensually with eyes closed",
      "passando ambas as mãos pelos cabelos sensualmente de olhos fechados",
    ],
    "sliding hand down body": [
      "hand sliding slowly down from chest over stomach toward hips",
      "mão a deslizar lentamente do peito pelo abdómen em direção aos quadris",
    ],
    "slowly undressing": [
      "in the process of slowly removing clothing, half undressed",
      "no processo de despir lentamente a roupa, semivestido",
    ],
    "smearing lipstick": [
      "lipstick smeared messily across lips",
      "batom borrado nos lábios",
    ],
    "spreading legs slowly": [
      "slowly spreading legs apart wider",
      "a abrir lentamente as pernas mais afastadas",
    ],
    "squeezing breasts together": [
      "hands squeezing breasts together tightly, deepening cleavage",
      "mãos a apertar os seios com força, aprofundando o decote",
    ],
    "stepping out of panties": [
      "panties around ankles, one foot stepping out of them",
      "cuecas nos tornozelos, um pé a sair delas",
    ],
    "sucking finger": [
      "sucking on finger with lips wrapped around it",
      "a chupar o dedo com os lábios à volta",
    ],
    "touching neck sensually": [
      "hand on neck, head tilted, fingers trailing along throat",
      "mão no pescoço, cabeça inclinada, dedos a deslizar pela garganta",
    ],
    "undoing bra clasp": [
      "hands behind back undoing bra clasp, bra loosening",
      "mãos atrás das costas a abrir o fecho do sutiã",
    ],
  },
  sensualGroupActions: {
    "being carried against wall": [
      "Two distinct adult bodies in close contact: a man is standing and holding a woman up against a flat wall, her legs wrapped firmly around his waist, facing each other with locked eyes and intimate physical contact, perfectly separated limbs, no extra body parts",
      "homem a segurá-la presa contra a parede, pernas à volta da cintura",
    ],
    "being fingered": [
      "Two distinct consenting adults interacting closely: a man is positioned near a woman, his hand placed precisely between her legs with realistic finger contact, proper anatomical alignment, clear and separate body proportions",
      "a mão dele entre as pernas dela, com os dedos no interior",
    ],
    "being held down on bed": [
      "Two distinct adults on a bed: a man is leaning over a woman, firmly holding both of her wrists down against the mattress above her head, maintaining realistic body weight distribution and correct limb anatomy",
      "homem a segurar os pulsos dela na cama acima da cabeça",
    ],
    "being kissed on neck from behind": [
      "Two distinct adults standing together: a man is positioned directly behind a woman, kissing and biting her neck while his hands grip her hips securely, clear spatial depth, correct anatomical separation of both figures",
      "homem em pé por trás a beijar e morder o pescoço, mãos nas ancas",
    ],
    "being pinned against wall": [
      "Two distinct adults against a vertical wall: a man is pressing a woman's body face-first against the wall from behind, holding her waist with precise structural contact, no merging of limbs",
      "homem a pressionar o corpo dela contra a parede por trás",
    ],
    "bent over receiving from behind": [
      "Two distinct adults in an intimate posture: a woman is bent forward at the waist with an arched back, while a man is positioned directly behind her performing entry, his hands firmly gripping her hips, perfectly delineated skeletons",
      "inclinada com o homem a penetrá-la por trás, mãos a agarrar as ancas",
    ],
    "blowjob on knees": [
      "Two distinct adults: a woman is kneeling directly on the floor in front of a standing or sitting man, performing oral sex with realistic facial positioning and direct eye contact looking upward, clear body boundaries",
      "de joelhos com o pénis ereto dele na boca, a olhar para cima",
    ],
    "cowgirl riding": [
      "Two distinct adults: a woman is straddling on top of a man lying on a surface, facing forward and riding actively with her hips, her hands resting on his chest, distinct anatomical separation and correct perspective",
      "montada por cima dele a cavalgar com o pénis no interior",
    ],
    "deep throat": [
      "Two distinct adults: a woman is kneeling closely in front of a partner, positioned with precise mouth-to-body alignment, maintaining clear facial identity and distinct anatomical structures",
      "de joelhos com o pénis dele fundo na garganta",
    ],
    "doggy style": [
      "Two distinct adults: a woman is on all fours with an arched back, while a man is positioned behind her with his hands on her waist, maintaining anatomically accurate joint connections and clear individual body forms",
      "de quatro com o homem a investir por trás",
    ],
    "face sitting on him": [
      "Two distinct adults in close interaction: a woman is sitting directly on a man's face, her thighs framing his head while he lies underneath, correct perspective and anatomically plausible contact",
      "sentada no rosto dele, boca entre as pernas",
    ],
    "giving handjob": [
      "Two distinct adults: a woman's hand is wrapped securely around an erect penis, performing a smooth stroking motion, with realistic finger placement and separate body framing",
      "mão dela envolta no pénis ereto dele, a masturbá-lo",
    ],
    "grabbed by hair from behind": [
      "Two distinct adults: a man is standing directly behind a woman, gently gripping her hair to pull her head back in an intimate pose, clear depth layers between the two figures",
      "homem a agarrar o cabelo e a puxar a cabeça para trás",
    ],
    "grinding on his lap": [
      "Two distinct adults sitting face-to-face: a woman is straddling a man's lap, grinding her hips against him with aligned torsos and separate, realistic arm placements",
      "sentada no colo dele a esfregar as ancas, face a face",
    ],
    "hand around her throat": [
      "Two distinct adults facing each other: a man's hand is lightly and securely cupped around a woman's throat, realistic hand anatomy, correct proportions, no distortion",
      "mão do homem a apertar suavemente a garganta dela",
    ],
    "hands tied while being taken": [
      "Two distinct adults: a woman's hands are bound together above her head during an intimate interaction with a partner, clear separation of limbs and correct skeletal alignment",
      "mãos atadas acima da cabeça enquanto o homem a possui",
    ],
    "him holding her legs up missionary": [
      "Two distinct adults on a bed: a woman is lying on her back with her legs held up and wide apart by a partner positioned between them, correct anatomical structure and clear physical contact points",
      "deitada de costas com o homem a segurar as pernas levantadas",
    ],
    "him pulling her hair during doggy": [
      "Two distinct adults: a woman is on all fours while a man positioned behind her pulls her hair back with one hand and holds her waist with the other, perfectly distinct bodies",
      "de quatro com o homem atrás a puxar o cabelo com uma mão",
    ],
    "kissing passionately": [
      "Two distinct adult figures locked in a deep, passionate kiss with open mouths and closely pressed upper bodies, showing absolute separation of individual limbs and correct facial proportions",
      "beijo profundo com bocas abertas e línguas em contacto",
    ],
    "legs over his shoulders": [
      "Two distinct adults: a woman is lying flat on her back with both of her legs resting up over a partner's shoulders, anatomically correct joint bends and clear individual form",
      "deitada de costas com ambas as pernas sobre os ombros dele",
    ],
    "legs wrapped around him standing": [
      "Two distinct adults face-to-face: a woman is lifted completely into the air with her legs wrapped tightly around a man's waist, her arms around his neck, correct weight support and physics",
      "suspensa com as pernas à volta da cintura dele, face a face",
    ],
    "lying back receiving oral": [
      "Two distinct adults: a woman is lying on her back with legs spread wide open, and a partner's face is positioned between her thighs, clear spatial separation and realistic proportions",
      "deitada de costas com pernas abertas, rosto dele entre as coxas",
    ],
    missionary: [
      "Two distinct adults: a woman is lying on her back with a partner positioned on top between her legs in a classic missionary alignment, correct overlay of torsos and separate limbs",
      "deitada de costas com o homem por cima a penetrá-la",
    ],
    "on top reverse cowgirl": [
      "Two distinct adults: a woman is sitting on top of a partner facing away toward his feet, performing a reverse riding position with correct anatomical orientation",
      "sentada por cima dele virada de costas, a cavalgar",
    ],
    "pressed against glass": [
      "Two distinct adults: a woman's body and breasts are pressed flat against a transparent glass surface from behind by a partner, realistic surface deformation and clear depth separation",
      "seios e corpo pressionados contra superfície de vidro por trás",
    ],
    "prone bone": [
      "Two distinct adults on a bed: a woman is lying flat face down while a partner is positioned on top executing a prone-position entry, correct weight distribution and body layers",
      "deitada de bruços com o homem deitado por cima a penetrar",
    ],
    "receiving facial": [
      "Two distinct adults: a woman is kneeling with eyes closed as a partner finishes close to her face, realistic fluid details, correct individual face and head proportions",
      "de joelhos de olhos fechados, com sémen no rosto",
    ],
    "reverse cowgirl": [
      "Two distinct adults: a woman is sitting on top of a partner facing away from his face, riding actively with synchronized body posture and clearly separated anatomy",
      "sentada por cima dele virada ao contrário, a cavalgar",
    ],
    "side by side spooning": [
      "Two distinct adults lying down: a woman is on her side with a partner spooning closely behind her in an intimate lateral position, parallel bodies with distinct outlines",
      "deitada de lado com o homem em concha por trás",
    ],
    "sitting on his face": [
      "Two distinct adults: a woman is squatting closely over a partner's face, maintaining a stable and anatomically plausible posture with clear separation between the two figures",
      "agachada sobre o rosto dele, língua entre as pernas",
    ],
    "spread eagle for him": [
      "Two distinct adults: a woman is lying flat on her back with legs spread extremely wide open as a partner positions in the center, correct perspective and proportional limbs",
      "deitada de costas com pernas totalmente abertas",
    ],
    "standing carry position": [
      "Two distinct adults: a man is carrying a woman upright in the air with her legs wrapped around his body, maintaining sturdy posture and realistic physical interaction",
      "homem a transportá-la no ar a penetrar em pé",
    ],
    "straddling his lap face to face": [
      "Two distinct adults face-to-face: a woman is straddling closely on a man's lap, arms wrapped around his neck with full upper-body contact and clearly defined individual silhouettes",
      "montada no colo dele face a face, braços ao pescoço",
    ],
    "sucking while looking up": [
      "Two distinct adults: a woman is kneeling and performing oral sex while lifting her chin to maintain direct eye contact looking upward, correct facial alignment and hand placement",
      "de joelhos a chupar o pénis com contacto visual a olhar para cima",
    ],
    "undressing each other": [
      "Two distinct adults interacting closely while pulling each other's clothing off in a mid-undressing state, precise hand-to-fabric interaction and separate body structures",
      "a despir a roupa um do outro, ambos semivestidos",
    ],
  },
  actions: {
    none: [
      "with a natural, unforced expression",
      "com expressão natural e espontânea",
    ],
    smile: [
      "smiling subtly, with relaxed eyes",
      "sorrindo discretamente, com olhar relaxado",
    ],
    eye: [
      "looking directly toward the camera",
      "olhando diretamente para a câmera",
    ],
    hair: [
      "gently adjusting their hair with one hand",
      "ajustando delicadamente o cabelo com uma das mãos",
    ],
    lookback: [
      "looking back over one shoulder",
      "olhando para trás por cima do ombro",
    ],
    confidence: [
      "projecting a confident yet natural expression",
      "expressando confiança de maneira natural",
    ],
    embrace: [
      "sharing a warm, consensual embrace",
      "compartilhando um abraço afetuoso e consensual",
    ],
    handshake: [
      "shaking hands naturally with another adult",
      "apertando a mão de outro adulto naturalmente",
    ],
    dance_pair: [
      "dancing socially with an adult partner, with balanced posture and natural hand contact",
      "dançando socialmente com um parceiro adulto, com postura equilibrada e contato natural das mãos",
    ],
    conversation: [
      "talking face to face with another adult, with natural conversational gestures",
      "conversando frente a frente com outro adulto, com gestos naturais de conversa",
    ],
    custom: [
      "performing the action specified in the custom instruction",
      "realizando a ação descrita na instrução personalizada",
    ],
  },
  cameras: {
    auto: [
      "a camera angle chosen to show the pose clearly without forcing the face toward the lens; allow natural facial occlusion",
      "ângulo de câmera que mostre a pose sem forçar o rosto em direção à lente; permita a oclusão natural do rosto",
    ],
    front: [
      "eye-level front camera view",
      "câmera frontal na altura dos olhos",
    ],
    threequarter: [
      "natural three-quarter camera angle",
      "ângulo natural de três quartos",
    ],
    side: [
      "natural side-profile camera angle",
      "ângulo lateral de perfil natural",
    ],
    low: [
      "subtle low-angle camera perspective",
      "perspectiva de câmera discretamente baixa",
    ],
    high: [
      "subtle high-angle camera perspective",
      "perspectiva de câmera discretamente elevada",
    ],
  },
  shots: {
    auto: [
      "balanced framing that fully includes the relevant edited elements",
      "enquadramento equilibrado que inclua os elementos relevantes à edição",
    ],
    portrait: [
      "head-and-shoulders portrait with the entire face unobstructed",
      "retrato de cabeça e ombros, com todo o rosto desobstruído",
    ],
    half: [
      "medium shot showing face, torso and arms",
      "plano médio incluindo rosto, tronco e braços",
    ],
    full: [
      "full-body framing with hands, legs and feet clearly visible",
      "enquadramento de corpo inteiro com mãos, pernas e pés visíveis",
    ],
    wide: [
      "wide shot with subjects visible in the environment",
      "plano aberto com personagens visíveis no ambiente",
    ],
  },
  lights: {
    soft: [
      "soft daylight, natural skin response and gentle believable shadows",
      "luz natural suave, resposta natural da pele e sombras delicadas e críveis",
    ],
    studio: [
      "professional controlled studio lighting, subtle catchlights and balanced shadows",
      "iluminação profissional de estúdio, reflexos suaves e sombras equilibradas",
    ],
    golden: [
      "golden-hour directional light with warm natural highlights",
      "luz direcional de fim de tarde com realces quentes e naturais",
    ],
    moody: [
      "cinematic low-key lighting with controlled contrast",
      "iluminação cinematográfica dramática com contraste controlado",
    ],
    night: [
      "natural nighttime practical lights with plausible reflections",
      "luzes noturnas naturais com reflexos plausíveis",
    ],
  },
  styles: {
    real: [
      "photorealistic professional photography, natural pores, realistic hair strands, true-to-life fabric detail",
      "fotografia profissional fotorrealista, poros naturais, fios de cabelo realistas e detalhes fiéis dos tecidos",
    ],
    anime: [
      "premium contemporary anime illustration, crisp expressive line art, controlled cel shading, coherent anime anatomy",
      "ilustração anime contemporânea de qualidade, linhas expressivas e definidas, sombreamento cel-shading controlado e anatomia consistente",
    ],
    cinematic: [
      "premium cinematic film still, natural skin, filmic contrast, realistic photographic depth",
      "frame cinematográfico de alto nível, pele natural, contraste de cinema e profundidade fotográfica realista",
    ],
    illustration: [
      "polished semi-realistic digital illustration, consistent material rendering, elegant color design",
      "ilustração digital semirrealista refinada, materiais consistentes e design elegante de cores",
    ],
  },
  expressions: {
    smile: [
      "a small closed-mouth smile, relaxed cheeks and soft eyes",
      "um sorriso discreto com boca fechada, bochechas relaxadas e olhar suave",
    ],
    neutral: [
      "relaxed eyebrows, closed lips and a calm gaze",
      "sobrancelhas relaxadas, lábios fechados e olhar calmo",
    ],
    confident: [
      "steady eye contact, a subtly lifted chin and relaxed closed lips",
      "contato visual firme, queixo levemente elevado e lábios fechados relaxados",
    ],
    serene: [
      "soft eyes, relaxed eyebrows and a faint closed-mouth smile",
      "olhar suave, sobrancelhas relaxadas e um leve sorriso com boca fechada",
    ],
    looking: [
      "eyes directed at the camera, with a relaxed mouth",
      "olhos direcionados à câmera e boca relaxada",
    ],
    laugh: [
      "a natural laugh, lifted cheeks and a slightly open mouth",
      "uma risada natural, bochechas elevadas e boca ligeiramente aberta",
    ],
    thoughtful: [
      "eyes looking slightly away, relaxed closed lips and a thoughtful expression",
      "olhar ligeiramente desviado, lábios fechados relaxados e expressão pensativa",
    ],
    serious: [
      "a steady gaze, neutral eyebrows and closed lips without a smile",
      "olhar firme, sobrancelhas neutras e lábios fechados sem sorriso",
    ],
    eyesclosed: [
      "gently closed eyelids and relaxed facial muscles",
      "pálpebras suavemente fechadas e músculos faciais relaxados",
    ],
    surprise: [
      "slightly raised eyebrows, widened eyes and a softly parted mouth",
      "sobrancelhas levemente elevadas, olhos mais abertos e boca discretamente entreaberta",
    ],
    coy: [
      "a subtle closed-mouth smile and eyes looking slightly sideways",
      "um sorriso discreto com boca fechada e olhar ligeiramente de lado",
    ],
  },
  protect: {
    face: [
      "preserve the same facial identity and recognizable facial features, including eye shape, nose, lips and facial proportions",
      "preserve a mesma identidade facial e os traços reconhecíveis, incluindo formato dos olhos, nariz, lábios e proporções faciais",
    ],
    body: [
      "preserve the existing body silhouette, proportions and distinctive physique; no automatic slimming or reshaping",
      "preserve a silhueta corporal, as proporções e o físico característico; sem emagrecimento ou remodelação automática",
    ],
    skin: [
      "preserve the original skin tone and natural skin texture",
      "preserve o tom de pele original e a textura natural da pele",
    ],
    hair: [
      "preserve the original hairstyle, hairline, color and length",
      "preserve o penteado, linha capilar, cor e comprimento originais",
    ],
    pose: [
      "keep the original body position and joint alignment",
      "mantenha a posição corporal e o alinhamento das articulações originais",
    ],
    clothes: [
      "keep the original clothing, color and fabric design",
      "mantenha o vestuário, cor e desenho de tecido originais",
    ],
    environment: [
      "keep the original environment and background layout",
      "mantenha o ambiente e a disposição do fundo originais",
    ],
    lighting: [
      "keep the original lighting direction and shadow behavior",
      "mantenha a direção de luz e o comportamento das sombras originais",
    ],
  },
  refRoles: {
    target: ["primary image to be edited", "imagem principal a ser editada"],
    character: [
      "the visual reference for the original protagonist",
      "referência visual para o protagonista original",
    ],
    second_participant: [
      "the visual reference for the second participant",
      "referência visual para o segundo personagem",
    ],
    face: [
      "reference for facial identity only",
      "referência somente para identidade facial",
    ],
    body: [
      "reference for body proportions",
      "referência para proporções corporais",
    ],
    outfit: [
      "reference for outfit design",
      "referência para o desenho da roupa",
    ],
    pose: [
      "reference for pose and body orientation",
      "referência para pose e orientação corporal",
    ],
    environment: [
      "reference for environment and background",
      "referência para ambiente e fundo",
    ],
  },
};

const builtinPoseNames = {
  neutral: "Em pé · braços relaxados",
  seated: "Sentado · postura ereta",
  kneeling: "Ajoelhado · tronco ereto",
  lookback: "Giro de tronco · olhar sobre o ombro",
  walking: "Caminhada · passo natural",
  recline: "Reclinado no sofá",
  handsknees: "Apoio em mãos e joelhos",
  side: "Deitado de lado · corpo apoiado",
  walllean: "Em pé · costas na parede",
  chairside: "Cadeira · sentado de lado",
  ankles: "Cadeira · tornozelos cruzados",
  sofaarm: "Sofá · cotovelo no apoio",
  bededge: "Cama · sentado na borda",
  hiphand: "Em pé · uma mão na cintura",
  armsup: "Em pé · mãos atrás da cabeça",
  seatedcross: "Cadeira · pernas cruzadas",
  floorseated: "Chão · pernas cruzadas",
  custom: "Conforme texto livre",
};

const sensualPoseNames = {
  "arched back on all fours": "Costas profundamente arqueadas · mãos e joelhos",
  "ass up face down": "Rosto para baixo · quadril elevado",
  "back arched standing": "Em pé · costas arqueadas e peito à frente",
  "bent over": "Inclinado à frente pela cintura",
  "bent over looking back": "Inclinado à frente · olhando para trás",
  "chest pressed together arms": "Braços a juntar e elevar os seios",
  "hands and knees": "Mãos e joelhos · costas levemente arqueadas",
  "kneeling legs apart": "Ajoelhado · joelhos afastados",
  "kneeling looking up": "Ajoelhado · a olhar para cima",
  "legs open seated": "Sentado · pernas abertas",
  "legs spread lying back": "Deitado de costas · pernas abertas",
  "legs up lying back": "Deitado de costas · pernas erguidas no ar",
  "lying face down hips raised": "De bruços · quadril elevado",
  "lying on back knees bent":
    "Deitado de costas · joelhos flexionados ao peito",
  "lying on side leg raised": "De lado · perna superior elevada",
  "on elbows and knees": "Antebraços e joelhos · quadril elevado",
  "on knees back arched": "De joelhos · costas arqueadas",
  "on knees hands on thighs": "De joelhos · mãos nas coxas",
  "one leg up against wall": "Em pé · uma perna elevada na parede",
  "presenting from behind": "De quatro · quadril apresentado para trás",
  "reclining legs parted": "Reclinado · pernas entreabertas",
  "riding position": "Posição de montaria com quadril projetado",
  "sitting legs open": "Sentado · pernas bem abertas",
  "sitting spread eagle": "Sentado · pernas completamente abertas",
  "squatting legs apart": "Agachamento · joelhos afastados",
  "standing bent at waist": "Em pé · inclinado à frente",
  "standing legs apart": "Em pé · pernas afastadas",
  straddling: "Montado com uma perna de cada lado",
  "stretching on bed": "Alongando o corpo na cama",
  "topless covering with hands": "Sem camisa · cobrindo os seios com as mãos",
  "topless hair covering": "Sem camisa · cabelo cobrindo os seios",
};

const sensualActionNames = {
  "arching back in pleasure": "Arqueando as costas de prazer",
  "biting finger": "Mordendo o dedo de forma sedutora",
  "biting lip": "Mordendo o lábio inferior",
  "caressing inner thigh": "Acariciando a parte interna da coxa",
  "cupping breasts": "Segurando e apertando os seios",
  "dripping wet from shower": "Molhado e brilhante do duche",
  "finger in mouth": "Dedo na boca de forma sugestiva",
  "grabbing bedsheets": "Agarrando os lençóis com força",
  "grinding on pillow": "Esfregando o quadril numa almofada",
  "hands between legs": "Mão entre as pernas abertas",
  "holding vibrator": "Segurando um vibrador",
  "licking finger": "Lamber a ponta do dedo",
  "licking lollipop": "Lamber chupa-chupa sugestivamente",
  "looking over shoulder seductively": "Olhar sedutor por cima do ombro",
  "moaning expression": "Expressão de êxtase / gemido",
  "oil dripping on body": "Óleo corporal brilhante na pele",
  "peeling off shirt": "A despir a camisa pela cabeça",
  "playing with waistband": "Puxando levemente o cós da roupa",
  "pulling down strap": "Puxando a alça para fora do ombro",
  "pulling hair back": "Puxando o cabelo para trás",
  "pulling panties aside": "Puxando as cuecas para o lado",
  "rubbing lotion on legs": "Espalhando loção nas pernas",
  "running hands through hair": "Passando as mãos pelos cabelos",
  "sliding hand down body": "Mão a deslizar do peito para o quadril",
  "slowly undressing": "Em processo de despir-se lentamente",
  "smearing lipstick": "Batom borrado",
  "spreading legs slowly": "Abrindo as pernas lentamente",
  "squeezing breasts together": "Apertando os seios para aprofundar decote",
  "stepping out of panties": "A sair de dentro das cuecas",
  "sucking finger": "Chupando o dedo",
  "touching neck sensually": "Tocando o pescoço sensualmente",
  "undoing bra clasp": "Abrindo o fecho do sutiã",
};

const sensualGroupActionNames = {
  "being carried against wall": "Carregado contra a parede",
  "being fingered": "Sendo estimulada com os dedos",
  "being held down on bed": "Imobilizada na cama",
  "being kissed on neck from behind": "Beijo no pescoço por trás",
  "being pinned against wall": "Pressionada contra a parede por trás",
  "bent over receiving from behind": "Inclinada recebendo por trás",
  "blowjob on knees": "Sexo oral de joelhos",
  "cowgirl riding": "Cavalgando por cima (Cowgirl)",
  "deep throat": "Garganta profunda",
  "doggy style": "Estilo Doggy Style",
  "face sitting on him": "Sentada no rosto dele",
  "giving handjob": "Masturbação manual",
  "grabbed by hair from behind": "Agarrada pelo cabelo por trás",
  "grinding on his lap": "Esfregando as ancas no colo dele",
  "hand around her throat": "Mão na garganta",
  "hands tied while being taken": "Mãos atadas",
  "him holding her legs up missionary": "Missionário com pernas levantadas",
  "him pulling her hair during doggy": "Puxando o cabelo em doggy style",
  "kissing passionately": "Beijo apaixonado",
  "legs over his shoulders": "Pernas sobre os ombros dele",
  "legs wrapped around him standing": "Pernas à volta da cintura em pé",
  "lying back receiving oral": "Sexo oral deitada de costas",
  missionary: "Posição missionária",
  "on top reverse cowgirl": "Reverse cowgirl por cima",
  "pressed against glass": "Pressionada contra vidro",
  "prone bone": "Prone bone (de bruços)",
  "receiving facial": "Ejaculação facial",
  "reverse cowgirl": "Reverse cowgirl",
  "side by side spooning": "De lado em concha (Spooning)",
  "sitting on his face": "Sentada no rosto",
  "spread eagle for him": "Aberta para ele",
  "standing carry position": "Carregada em pé",
  "straddling his lap face to face": "No colo face a face",
  "sucking while looking up": "Chupando olhando para cima",
  "undressing each other": "Despindo-se mutuamente",
};

const builtinActionNames = {
  none: "Expressão natural",
  smile: "Sorriso discreto",
  eye: "Olhar para câmera",
  hair: "Ajustar cabelo",
  lookback: "Olhar por cima do ombro",
  confidence: "Expressão confiante",
  embrace: "Abraçar (dois adultos)",
  handshake: "Apertar mãos (dois adultos)",
  dance_pair: "Dançar em dupla (dois adultos)",
  conversation: "Conversar (dois adultos)",
  custom: "Conforme texto livre",
};

const compactProtect = {
  face: ["facial identity", "identidade facial"],
  body: [
    "body proportions, without reshaping",
    "proporções corporais, sem remodelação",
  ],
  skin: ["skin tone and texture", "tom e textura da pele"],
  hair: ["hairstyle", "penteado"],
  pose: ["original pose", "pose original"],
  clothes: ["original outfit", "roupa original"],
  environment: ["original background", "fundo original"],
  lighting: ["original lighting", "iluminação original"],
};

const garmentColors = {
  black: ["black", "preta"],
  white: ["white", "branca"],
  red: ["red", "vermelha"],
  blue: ["blue", "azul"],
  burgundy: ["burgundy", "vinho"],
  beige: ["beige", "bege"],
  green: ["green", "verde"],
};

const garmentMaterials = {
  cotton: ["cotton", "algodão"],
  linen: ["linen", "linho"],
  silk: ["silk", "seda"],
  satin: ["satin", "cetim"],
  denim: ["denim", "jeans"],
  leather: ["leather", "couro"],
  knit: ["knit fabric", "tricô"],
};

function trans(obj, key, lang) {
  if (!obj[key]) return "";
  return lang === "en" ? obj[key][0] : obj[key][1];
}

function preservePhrase(key, lang, changePose) {
  if (key === "body" && changePose)
    return lang === "en"
      ? "preserve original body proportions while allowing joint repositioning"
      : "preserve as proporções corporais originais, permitindo reposicionar articulações";
  if (key === "pose" && changePose)
    return lang === "en"
      ? "replace the original pose while retaining anatomically correct joint connections"
      : "substitua a pose original preservando as conexões anatomicamente corretas das articulações";
  return trans(dict.protect, key, lang);
}

function editedOutfit(lang) {
  if (val("editWardrobe") === "custom")
    return (
      val(lang === "en" ? "wardrobeEn" : "wardrobePt").trim() ||
      trans(dict.wardrobe, "custom", lang)
    );
  let text = trans(dict.wardrobe, val("editWardrobe"), lang);
  if (val("wardrobeColor") !== "auto") {
    text = text
      .replace(
        lang === "en"
          ? /\b(black|white|red|blue|burgundy|navy|beige|green|ivory|grey|gray|dark|charcoal|cream)\b\s*/gi
          : /\b(preto|preta|pretos|pretas|branco|branca|brancos|brancas|vermelho|vermelha|azul-marinho|azul|vinho|bege|verde|marfim|cinza-escura|cinza-escuro|cinza|escuro|escura|creme)\b\s*/gi,
        "",
      )
      .trim();
  }
  if (val("wardrobeMaterial") !== "auto") {
    text = text
      .replace(
        lang === "en"
          ? /\b(cotton|linen|silk|satin|denim|leather|knit)\b\s*/gi
          : /\b(?:(?:de|em)\s+)?(algodão|linho|seda|cetim|couro|tricô)(?=\s|$)\s*/gi,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();
    if (lang === "en") text = text.replace(/\bjeans\b/g, "trousers");
    else text = text.replace(/\bjeans\b/g, "calça");
  }
  if (val("wardrobeColor") !== "auto")
    text +=
      (lang === "en" ? "; use " : "; use a cor ") +
      trans(garmentColors, val("wardrobeColor"), lang) +
      (lang === "en"
        ? " for all garment fabric"
        : " em todo o tecido das peças");
  if (val("wardrobeMaterial") !== "auto")
    text +=
      (lang === "en"
        ? "; all garment fabric made of "
        : "; tecido de todas as peças em ") +
      trans(garmentMaterials, val("wardrobeMaterial"), lang);
  return text;
}

function pushIf(arr, condition) {
  if (condition) arr.push(condition);
}

function getPose(key, l) {
  if (!key) return "";
  if (key.startsWith("sensual:"))
    return trans(dict.sensualPoses, key.slice(8), l);
  if (key.startsWith("import:")) {
    let name = key.slice(7),
      v = app.packs.poses[name] ?? "";
    return typeof v === "object" ? v[l] || v.en || "" : v;
  }
  return trans(dict.poses, key, l);
}

function getAction(key, l) {
  if (!key) return "";
  if (key.startsWith("sensual:"))
    return trans(dict.sensualActions, key.slice(8), l);
  if (key.startsWith("group:"))
    return trans(dict.sensualGroupActions, key.slice(6), l);
  if (key.startsWith("import:")) {
    let name = key.slice(7),
      v = app.packs.actions[name] ?? app.packs.group[name] ?? "";
    return typeof v === "object" ? v[l] || v.en || "" : v;
  }
  return trans(dict.actions, key, l);
}

// Contratos das interações não explícitas; o compositor usa a contagem, não o nome da ação.
const ordinaryActionParticipants = Object.freeze({
  embrace: 2,
  handshake: 2,
  dance_pair: 2,
  conversation: 2,
});

function actionRequiredParticipants(key) {
  const name = String(key || "").replace(/^basic:/, "");
  return ordinaryActionParticipants[name] || 1;
}

function actionNeedsPartner(key) {
  return actionRequiredParticipants(key) > 1;
}

function describedParticipants(description) {
  const text = String(description || "").toLowerCase();
  const counts = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const match =
    /\b(two|three|four|five|six|seven|eight|nine|ten|[2-9]|10)\s+(?:distinct\s+)?(?:adult\s+)?(?:adults|people|persons|participants|characters)\b/.exec(
      text,
    );
  if (match) return counts[match[1]] || Number(match[1]);
  return /\bwith (?:an? |the )?(?:adult )?partner\b|\bfacing each other\b|\bwith another (?:adult|person|character)\b/.test(
    text,
  )
    ? 2
    : 1;
}

function poseRequiredParticipants(key) {
  const imported = String(key || "").startsWith("import:")
    ? app.packs?.poses?.[String(key).slice(7)]
    : null;
  const declared = imported?.participants;
  if (Number.isInteger(declared) && declared >= 1 && declared <= 10)
    return declared;
  return describedParticipants(getPose(key || "", "en"));
}

function sceneRequiredParticipants() {
  if (app.mode !== "edit") return 1;
  const ops = activeOperations();
  const action =
    ops.includes("action") && typeof selectedEditAction === "function"
      ? selectedEditAction()
      : null;
  const declared = action?.participants;
  const actionCount = !ops.includes("action")
    ? 1
    : Number.isInteger(declared) && declared >= 1 && declared <= 10
      ? declared
      : Math.max(
          actionRequiredParticipants(val("editAction")),
          describedParticipants(action?.prompt),
        );
  return Math.max(
    actionCount,
    ops.includes("pose") ? poseRequiredParticipants(val("editPose")) : 1,
  );
}

function artisticFigureStudyActive(editing = app.mode === "edit") {
  if (!editing)
    return (
      val("wardrobe") === "figure_study" &&
      Boolean($("fictionalGenerate").checked)
    );
  const ops = activeOperations();
  return (
    Boolean($("fictionalConfirm").checked) &&
    (ops.includes("removeall") ||
      (ops.includes("wardrobe") && val("editWardrobe") === "figure_study"))
  );
}

function artisticFigureInstruction(lang) {
  return lang === "en"
    ? "- Depict this adult character without clothing. Preserve the established facial identity and body proportions."
    : "- Represente este personagem adulto sem roupas. Preserve a identidade facial e as proporções corporais estabelecidas";
}

function participantRequirement(total, lang, editing) {
  if (!Number.isInteger(total) || total < 2 || total > 10) return "";
  const en = lang === "en";
  const dressed = !artisticFigureStudyActive(editing);
  const adults = dressed
    ? "distinct, appropriately clothed adults"
    : "distinct adults";
  const dressPt = dressed ? ", com roupa adequada" : "";
  if (editing)
    return en
      ? `This action requires ${total} participants. Reuse participants already in <image1> and add only the missing ${adults} to complete the action. Preserve the original protagonist's identity.`
      : `Esta ação exige ${total} participantes. Use os participantes já presentes em <image1> e acrescente somente os adultos distintos${dressPt} que faltarem para completar a ação. Preserve a identidade do protagonista original.`;
  if (val("subject") === "two" && total === 2)
    return en
      ? "Use the two requested adults for this action, without adding another person."
      : "Use os dois adultos solicitados para esta ação, sem acrescentar outra pessoa.";
  if (val("subject") === "custom")
    return en
      ? `This action requires ${total} participants. Use characters already described and add only the missing ${adults}.`
      : `Esta ação exige ${total} participantes. Use os personagens já descritos e acrescente somente os adultos distintos${dressPt} que faltarem.`;
  const present = val("subject") === "two" ? 2 : 1,
    missing = total - present;
  return en
    ? `Add exactly ${missing} ${dressed ? "distinct, appropriately clothed adult" : "distinct adult"} ${missing === 1 ? "partner" : "partners"} for this action, making ${total} people in total. Preserve the primary protagonist's appearance.`
    : `Acrescente exatamente ${missing} ${missing === 1 ? "parceiro adulto distinto" : "parceiros adultos distintos"}${dressPt} para esta ação, totalizando ${total} pessoas. Preserve a aparência do protagonista principal.`;
}

function partnerRequirement(key, lang, editing) {
  return participantRequirement(actionRequiredParticipants(key), lang, editing);
}

// Integridade anatômica: regras gerais e correções condicionais para poses.
// Mantém EN/PT, não altera chaves de presets nem depende de controles novos no HTML.
// Orientação do corpo sempre precede visibilidade facial e enquadramento.
const anatomyGuidance = {
  universal: [
    "Keep head, neck, spine and pelvis naturally connected, limb proportions consistent, joints natural and support stable; no disconnected or duplicated limbs.",
    "Mantenha cabeça, pescoço, coluna e pelve conectados naturalmente, proporções dos membros consistentes, articulações naturais e apoio estável; sem membros desconectados ou duplicados.",
  ],
  faceDown: [
    "Keep head and face downward with the torso and neck aligned with the spine; allow facial occlusion.",
    "Mantenha cabeça e rosto voltados para baixo com o tronco e pescoço alinhado à coluna; permita o rosto oculto.",
  ],
  rearFacing: [
    "Keep head and torso in a compatible orientation; allow the face to be hidden. An identity reference does not require a frontal face.",
    "Mantenha cabeça e tronco em orientações compatíveis; permita que o rosto fique oculto. Uma referência de identidade não exige mostrar o rosto de frente.",
  ],
  weightBearing: [
    "Anchor weight-bearing hands or forearms and knees, with natural joint alignment and contact shadows.",
    "Apoie mãos ou antebraços e joelhos que sustentam o peso, com articulações naturais e sombras de contato.",
  ],
  lookingBack: [
    "Turn neck, shoulders and upper torso together for the backward glance; do not force a frontal face.",
    "Gire pescoço, ombros e tronco superior juntos para olhar para trás; não force um rosto frontal.",
  ],
  bending: [
    "Bend through the hips and a continuous spine, keeping rib cage and pelvis connected without overextension.",
    "Flexione pelos quadris e por uma coluna contínua, mantendo tórax e pelve conectados sem hiperextensão.",
  ],
  raisedLegs: [
    "Keep each leg connected to its hip, knees bending naturally and each foot attached to its own leg.",
    "Mantenha cada perna conectada ao seu quadril, joelhos dobrando naturalmente e cada pé ligado à sua perna.",
  ],
  seated: [
    "Support the pelvis firmly, with hips and legs aligned to the support and perspective.",
    "Apoie a pelve firmemente, com quadris e pernas alinhados ao apoio e à perspectiva.",
  ],
  sideLying: [
    "Keep head and pelvis in the same side orientation, with lower shoulder and hip naturally supported.",
    "Mantenha cabeça e pelve na mesma orientação lateral, com ombro e quadril inferiores apoiados naturalmente.",
  ],
  multiPerson: [
    "Keep each person's skeleton and limbs separate, with stable support and correct depth ordering.",
    "Mantenha o esqueleto e os membros de cada pessoa separados, com apoio estável e profundidade correta.",
  ],
};

const anatomyPoseGroups = {
  faceDown: [
    "ass up face down",
    "lying face down hips raised",
    "on elbows and knees",
  ],
  weightBearing: [
    "arched back on all fours",
    "ass up face down",
    "hands and knees",
    "handsknees",
    "on elbows and knees",
    "presenting from behind",
  ],
  lookingBack: ["lookback", "bent over looking back", "presenting from behind"],
  bending: [
    "arched back on all fours",
    "ass up face down",
    "back arched standing",
    "bent over",
    "bent over looking back",
    "lying face down hips raised",
    "on elbows and knees",
    "on knees back arched",
    "presenting from behind",
    "standing bent at waist",
  ],
  raisedLegs: [
    "legs up lying back",
    "lying on side leg raised",
    "one leg up against wall",
    "lying on back knees bent",
    "kneeling legs apart",
    "legs open seated",
    "legs spread lying back",
    "sitting legs open",
    "sitting spread eagle",
    "squatting legs apart",
    "standing legs apart",
  ],
  seated: [
    "seated",
    "chairside",
    "ankles",
    "sofaarm",
    "bededge",
    "seatedcross",
    "floorseated",
    "recline",
    "reclining legs parted",
    "legs open seated",
    "sitting legs open",
    "sitting spread eagle",
    "straddling",
    "riding position",
    "lying on back knees bent",
    "legs spread lying back",
    "legs up lying back",
  ],
  sideLying: ["side", "lying on side leg raised"],
};

function actionTextForAnatomy(actionKey = "") {
  if (app.mode === "edit" && typeof selectedEditAction === "function")
    return selectedEditAction()?.prompt || "";
  return getAction(actionKey, "en") || "";
}

function anatomyCategories(poseKey, actionText = "") {
  const key = String(poseKey || "").replace(/^(sensual:|import:)/, "");
  const description = String(getPose(poseKey, "en") || "").toLowerCase();
  const actionDescription = actionText.toLowerCase();
  const categories = new Set();

  for (const [category, names] of Object.entries(anatomyPoseGroups)) {
    if (names.includes(key)) categories.add(category);
  }

  // Heurísticas para poses importadas. Os presets nativos são priorizados acima.
  if (
    /\b(?:back (?:facing|towards?|to) (?:the )?camera|facing away from (?:the )?camera|rear view|back view)\b/.test(
      description,
    )
  )
    categories.add("rearFacing");
  if (
    /\b(face down|face pressed down|lying prone|lying face down)\b/.test(
      description,
    )
  )
    categories.add("faceDown");
  if (
    /\b(on all fours|hands and knees|elbows and knees|on forearms and knees)\b/.test(
      description,
    )
  )
    categories.add("weightBearing");
  if (
    /\b(looking back|look back|over (one |the )?shoulder)\b/.test(
      description + " " + actionDescription,
    )
  )
    categories.add("lookingBack");
  if (
    /\b(arched back|back arched|bent forward|bent over|bent at the waist)\b/.test(
      description,
    )
  )
    categories.add("bending");
  if (
    /\b(leg raised|legs raised|legs up|knees spread|legs spread|legs apart|leg up)\b/.test(
      description,
    )
  )
    categories.add("raisedLegs");
  if (
    /\b(sitting|seated|reclining|straddling|lying on back)\b/.test(description)
  )
    categories.add("seated");
  if (/\b(lying on (one |the )?side|side-lying)\b/.test(description))
    categories.add("sideLying");
  return categories;
}

function getAnatomyGuidance(poseKey, lang, actionKey = "") {
  const idx = lang === "en" ? 0 : 1;
  const categories = anatomyCategories(
    poseKey,
    actionTextForAnatomy(actionKey),
  );
  if (String(actionKey).startsWith("group:")) categories.add("multiPerson");
  if (
    actionNeedsPartner(
      app.mode === "edit"
        ? activeOperations().includes("action")
          ? val("editAction")
          : ""
        : actionKey,
    )
  )
    categories.add("multiPerson");

  // A regra global é aplicada mesmo quando o texto da pose é livre ou importado.
  return [
    anatomyGuidance.universal[idx],
    ...Array.from(categories, (category) => anatomyGuidance[category][idx]),
  ].join(" ");
}

// A pose aparece na operação; a prioridade curta não repete sua descrição.
function poseAdherence(poseKey, lang, phase) {
  if (phase !== "start" || app.mode !== "edit" || !getPose(poseKey, lang))
    return "";
  return lang === "en"
    ? "Use the exact requested pose, replacing the source posture while preserving identity and proportions."
    : "Use a pose solicitada exatamente, substituindo a postura original e preservando identidade e proporções.";
}

function poseGazeContext() {
  const editing = app.mode === "edit",
    ops = activeOperations();
  const poseKey = editing
    ? ops.includes("pose")
      ? val("editPose")
      : ""
    : val("pose");
  const actionText = actionTextForAnatomy(editing ? "" : val("action"));
  const categories = anatomyCategories(poseKey, actionText);
  const faceDown = categories.has("faceDown");
  const rearFacing = categories.has("rearFacing"),
    lookingBack = categories.has("lookingBack");
  const actionGaze = /\blooking down\b/i.test(actionText)
    ? "down"
    : /\b(looking back|looking over|look over)\b/i.test(actionText)
      ? "back"
      : /\beye contact\b|\blooking (?:directly )?(?:at|into|toward) (?:the )?camera\b/i.test(
            actionText,
          )
        ? "camera"
        : "";
  return {
    faceDown,
    rearFacing,
    lookingBack,
    directedAction: Boolean(actionGaze),
    actionGaze,
    actionText,
  };
}

function consistentEditExpression(lang) {
  const key = val("editExpression"),
    context = poseGazeContext();
  if (
    context.faceDown ||
    (context.rearFacing && !context.lookingBack) ||
    context.directedAction
  ) {
    const withoutGaze = {
      confident: [
        "a confident expression with relaxed closed lips",
        "expressão confiante com lábios fechados relaxados",
      ],
      thoughtful: [
        "a thoughtful expression with relaxed closed lips",
        "expressão pensativa com lábios fechados relaxados",
      ],
      coy: [
        "a subtle closed-mouth smile",
        "um sorriso discreto com boca fechada",
      ],
    };
    if (withoutGaze[key]) return withoutGaze[key][lang === "en" ? 0 : 1];
  }
  return trans(dict.expressions, key, lang);
}

// Detecta apenas posturas declaradas no início da descrição do sujeito.
// Texto livre complexo ou com vários sujeitos não é interpretado como um contrato.
function leadingBodyPosture(description) {
  const text = String(description || "")
    .trim()
    .toLowerCase();
  const match =
    /^(?:(?:the subject|the protagonist|a person) (?:is )?)?(standing|sitting|seated|kneeling|walking|running|lying)\b/.exec(
      text,
    );
  if (!match) return "";
  const postures = new Set(
    (
      text.match(
        /\b(standing|sitting|seated|kneeling|walking|running|lying)\b/g,
      ) || []
    ).map((value) => (value === "sitting" ? "seated" : value)),
  );
  if (postures.size > 1) return "";
  return match[1] === "sitting" ? "seated" : match[1];
}

function actionPoseConflict() {
  if (app.mode !== "edit" || typeof selectedEditAction !== "function")
    return null;
  const ops = activeOperations();
  if (!ops.includes("pose") || !ops.includes("action")) return null;
  const action = selectedEditAction();
  if (!action || action.expression) return null;
  const actionPosture = leadingBodyPosture(action.prompt);
  const posePosture = leadingBodyPosture(getPose(val("editPose"), "en"));
  if (!actionPosture || !posePosture || actionPosture === posePosture)
    return null;
  const names = {
    standing: "em pé",
    seated: "sentado",
    kneeling: "ajoelhado",
    walking: "caminhando",
    running: "correndo",
    lying: "deitado",
  };
  return {
    field: "editPose",
    message: `A ação pede o personagem ${names[actionPosture]}, mas a pose escolhida pede ${names[posePosture]}. Desmarque Alterar pose para deixar a ação definir os movimentos necessários, ou escolha uma pose compatível.`,
  };
}

function poseControlConflict() {
  const editing = app.mode === "edit",
    ops = activeOperations(),
    context = poseGazeContext();
  const postureConflict = actionPoseConflict();
  if (postureConflict) return postureConflict;
  if (
    context.rearFacing &&
    !context.lookingBack &&
    context.actionGaze === "camera"
  )
    return {
      field: editing ? "editAction" : "action",
      message:
        "A pose pede o corpo de costas, mas a ação exige olhar para a câmera sem definir um giro compatível do tronco. Ajuste a ação ou escolha uma pose com giro natural sobre o ombro.",
    };
  if (context.faceDown && ["camera", "back"].includes(context.actionGaze))
    return {
      field: editing ? "editAction" : "action",
      message:
        "A pose mantém o rosto voltado para baixo, mas a ação pede olhar para a câmera ou para trás. Escolha uma ação compatível ou outra pose.",
    };
  if (!editing) return null;
  if (
    ops.includes("expression") &&
    val("editExpression") === "looking" &&
    (context.faceDown ||
      (context.rearFacing && !context.lookingBack) ||
      context.actionGaze === "down" ||
      (context.actionGaze === "back" &&
        !(context.rearFacing && context.lookingBack)))
  )
    return {
      field: "editExpression",
      message:
        "Olhar para a câmera entra em conflito com a direção do rosto definida pela pose ou ação. Escolha outra expressão ou ajuste a pose/ação.",
    };
  if (
    ops.includes("expression") &&
    val("editExpression") === "eyesclosed" &&
    /\breading\b/i.test(context.actionText)
  )
    return {
      field: "editExpression",
      message:
        "Ler o livro e manter os olhos fechados são escolhas incompatíveis. Ajuste a expressão ou a ação.",
    };
  return null;
}

function poseExpressionNotice() {
  if (app.mode !== "edit" || !activeOperations().includes("expression"))
    return "";
  return consistentEditExpression("en") !==
    trans(dict.expressions, val("editExpression"), "en")
    ? "A expressão foi mantida sem acrescentar uma direção de olhar ou posição de cabeça que conflite com a pose ou ação."
    : "";
}

function editSupportGuidance(lang, ops) {
  const pose = ops.includes("pose"),
    environment = ops.includes("environment");
  const action =
    typeof selectedEditAction === "function" ? selectedEditAction() : null;
  if (
    !pose &&
    !environment &&
    !(ops.includes("action") && action && !action.expression)
  )
    return "";
  const en = lang === "en",
    add = val("poseSupport") === "add";
  if (!pose && !environment && !add) return "";
  if (environment)
    return add
      ? en
        ? "Remove the old surroundings; provide only the support surfaces needed by the subject's posture, with natural weight-bearing contact in the new scene."
        : "Remova o cenário antigo; forneça somente as superfícies de apoio necessárias à postura, com contato natural e sustentação do peso no novo cenário."
      : en
        ? "Remove the old surroundings while retaining existing support surfaces needed by the subject's posture; adapt their appearance and contact shadows to the new scene."
        : "Remova o cenário antigo mantendo as superfícies de apoio existentes necessárias à postura; adapte sua aparência e sombras de contato ao novo cenário.";
  if (!add)
    return en
      ? "Use existing support surfaces with natural contact and joint alignment."
      : "Use superfícies de apoio existentes, com contato e articulações naturais.";
  return pose
    ? en
      ? "Use plausible support for the requested pose; add only the necessary support surface."
      : "Use apoio plausível para a pose; acrescente apenas a superfície necessária."
    : en
      ? "Use plausible support for the action; add only the necessary support surface."
      : "Use apoio plausível para a ação; acrescente apenas a superfície necessária.";
}

function compose(lang) {
  const en = lang === "en";
  const select = (o, k) => trans(o, k, lang);
  let lines = [],
    editing = app.mode === "edit",
    ops = activeOperations(),
    keep = getActualPreserve(),
    user = (en ? val("customEn") : val("customPt")).trim(),
    strategy = getEditStrategy();
  const secondNeeded = editing && sceneRequiredParticipants() > 1;
  const figureStudy = artisticFigureStudyActive(editing);
  if (figureStudy) keep = keep.filter((key) => key !== "clothes");
  const references = (
    typeof promptReferences === "function" ? promptReferences() : app.refs
  ).filter(
    (ref, i) =>
      i === 0 ||
      ref.characterSource ||
      ((ref.role !== "second_participant" || secondNeeded) &&
        (ref.role !== "outfit" || !figureStudy)),
  );
  const characterSlot = editing
    ? references.findIndex((ref) => ref.characterSource)
    : -1;
  const bodySlots = editing
    ? references.flatMap((ref, i) =>
        i > 0 && !ref.characterSource && ref.role === "body" ? [i] : [],
      )
    : [];
  const bodySlot = bodySlots.length ? bodySlots[0] : -1;
  if (bodySlot >= 0)
    keep = keep.filter((key) => !["body", "skin"].includes(key));
  const hasSecondParticipant =
    secondNeeded &&
    references.some(
      (ref, i) =>
        i > 0 && !ref.characterSource && ref.role === "second_participant",
    );
  if (editing) {
    pushIf(lines, en ? "Edit <image1>." : "Edite <image1>.");
    if (characterSlot >= 0) {
      const hair = !ops.includes("hair")
        ? en
          ? ", hairline and hairstyle"
          : ", linha capilar e penteado"
        : "";
      const protagonist = secondNeeded
        ? en
          ? "For the original protagonist, preserve"
          : "Para o protagonista original, preserve"
        : "Preserve";
      pushIf(
        lines,
        bodySlot >= 0
          ? en
            ? `${protagonist} facial identity${hair} from <image${characterSlot + 1}> across pose and perspective changes.`
            : `${protagonist} identidade facial${hair} de <image${characterSlot + 1}> ao mudar pose e perspectiva.`
          : en
            ? `${protagonist} facial identity, intrinsic skin tone and texture, distinctive marks${hair}, body proportions (torso, limbs, hands and feet) from <image${characterSlot + 1}> across pose and perspective changes; no reshaping.`
            : `${protagonist} identidade facial, tom e textura de pele intrínsecos, marcas características${hair}, proporções corporais (tronco, membros, mãos e pés) de <image${characterSlot + 1}> ao mudar pose e perspectiva; sem remodelação.`,
      );
      keep = keep.filter(
        (key) =>
          ![
            "face",
            "body",
            "skin",
            ...(!ops.includes("hair") ? ["hair"] : []),
          ].includes(key),
      );
    }
    if (bodySlot >= 0)
      pushIf(
        lines,
        en
          ? `Primary body source for the original protagonist: <image${bodySlot + 1}>. Preserve visible anatomy, silhouette, proportions, body skin tone, texture and distinctive marks across pose and action changes; no reshaping. Allow natural joint movement and perspective. Do not copy its facial identity, pose, clothing or setting; hidden details are unspecified.`
          : `Fonte corporal principal do protagonista original: <image${bodySlot + 1}>. Preserve anatomia visível, silhueta, proporções, tom de pele corporal, textura e marcas características ao mudar pose e ação; sem remodelação. Permita movimentos articulares e perspectiva naturais. Não copie identidade facial, pose, roupa ou cenário dessa referência; detalhes ocultos ficam não especificados.`,
      );
    for (let i = 1; i < references.length; i++) {
      const r = references[i];
      if (r.characterSource || i === bodySlot) continue;
      if (bodySlot >= 0 && r.role === "body") {
        pushIf(lines, en
          ? `Use <image${i + 1}> only as an additional view of the same protagonist's body; <image${bodySlot + 1}> remains the primary body source.`
          : `Use <image${i + 1}> apenas como vista adicional do corpo do mesmo protagonista; <image${bodySlot + 1}> continua sendo a fonte corporal principal.`);
        continue;
      }
      if (bodySlot >= 0 && r.role === "character") {
        pushIf(lines, en
          ? `Use <image${i + 1}> only as reference for the original protagonist's facial identity${ops.includes("hair") ? "" : " and hair"}.`
          : `Use <image${i + 1}> apenas como referência para identidade facial${ops.includes("hair") ? "" : " e cabelo"} do protagonista original.`);
        continue;
      }
      pushIf(
        lines,
        en
          ? `Use <image${i + 1}> only as ${trans(dict.refRoles, r.role, lang)}.`
          : `Use <image${i + 1}> apenas como ${trans(dict.refRoles, r.role, lang)}.`,
      );
    }
    if (hasSecondParticipant) {
      if (
        characterSlot < 0 &&
        !references.slice(1).some((ref) => ref.role === "character")
      )
        pushIf(
          lines,
          en
            ? "Preserve the original protagonist's identity from <image1>."
            : "Preserve a identidade do protagonista original de <image1>.",
        );
      pushIf(
        lines,
        en
          ? "Keep both participants' identities distinct; do not merge or swap their features."
          : "Mantenha distintas as identidades dos dois personagens; não misture nem troque seus traços.",
      );
    }
    if (ops.includes("pose"))
      pushIf(lines, poseAdherence(val("editPose"), lang, "start"));
    if (ops.length) {
      for (const op of [...ops].sort(
        (a, b) =>
          (a === "environment" ? -1 : 0) - (b === "environment" ? -1 : 0),
      )) {
        switch (op) {
          case "wardrobe":
            if (
              val("editWardrobe") === "figure_study" &&
              !$("fictionalConfirm").checked
            ) {
              pushIf(
                lines,
                en
                  ? "- Artistic figure study not applied: confirm that the image shows an exclusively fictional adult character."
                  : "- Estudo artístico não aplicado: confirme que a imagem representa exclusivamente um personagem adulto fictício.",
              );
            } else if (val("editWardrobe") === "figure_study") {
              pushIf(lines, artisticFigureInstruction(lang));
            } else
              pushIf(
                lines,
                en
                  ? `- Replace the current outfit with ${editedOutfit(lang)}. Use natural fabric draping.`
                  : `- Substitua o vestuário atual por ${editedOutfit(lang)}. Use caimento natural do tecido.`,
              );
            break;
          case "removeall":
            if ($("fictionalConfirm").checked) {
              pushIf(lines, artisticFigureInstruction(lang));
            } else
              pushIf(
                lines,
                en
                  ? "- Clothing-removal request not applied: confirmation that the source is exclusively a fictional adult character is required."
                  : "- Pedido de remoção integral de roupa não aplicado: é necessária a confirmação de que a origem é exclusivamente um personagem adulto fictício.",
              );
            break;
          case "outer":
            pushIf(
              lines,
              en
                ? "- Remove only the outer garment such as a jacket or coat, retaining an appropriate non-explicit base outfit. Preserve skin and body appearance."
                : "- Remova somente a peça de roupa externa, como jaqueta ou casaco, mantendo o vestuário de base não explícito. Preserve a aparência da pele e do corpo.",
            );
            break;
          case "environment":
            pushIf(
              lines,
              en
                ? `- Replace the background with ${select(dict.env, val("editLocation"))}. Match the subject's lighting and contact shadows to the new scene.`
                : `- Substitua o fundo por ${select(dict.env, val("editLocation"))}. Adapte a luz do personagem e as sombras de contato à nova cena.`,
            );
            break;
          case "pose":
            pushIf(
              lines,
              en
                ? `- Replace the current pose with: ${getPose(val("editPose"), lang)}.`
                : `- Substitua a pose atual por: ${getPose(val("editPose"), lang)}.`,
            );
            break;
          case "expression":
            pushIf(
              lines,
              en
                ? `- Change only the facial expression to ${consistentEditExpression(lang)}, without changing the facial identity.`
                : `- Modifique somente a expressão facial para ${consistentEditExpression(lang)}, sem alterar a identidade facial.`,
            );
            break;
          case "lighting":
            pushIf(
              lines,
              en
                ? `- Re-light the scene with ${select(dict.lights, val("light"))}. Keep physically plausible shadows and the same subject identity.`
                : `- Reilumine a cena com ${select(dict.lights, val("light"))}. Mantenha sombras plausíveis e a mesma identidade do personagem.`,
            );
            break;
          case "hair":
            pushIf(
              lines,
              en
                ? "- Modify the hairstyle according to the custom instruction; keep hair texture realistic and do not change facial identity."
                : "- Modifique o penteado conforme a instrução personalizada; mantenha textura realista sem mudar a identidade facial.",
            );
            break;
          case "cleanup":
            pushIf(
              lines,
              en
                ? "- Restore image clarity and coherent material detail; reduce compression artifacts without smoothing away natural facial features."
                : "- Recupere a nitidez e os detalhes coerentes de materiais; reduza artefatos de compressão sem alisar os traços faciais naturais.",
            );
            break;
        }
      }
    } else
      pushIf(
        lines,
        bodySlot >= 0
          ? en
            ? "Keep all other source elements unchanged."
            : "Mantenha os demais elementos da imagem original."
          : en
            ? "Follow the custom instruction; otherwise keep the source image unchanged."
            : "Siga a instrução personalizada; caso contrário, mantenha a imagem original.",
      );
    pushIf(lines, editSupportGuidance(lang, ops));
    if (strategy === "short") {
      if (keep.length)
        pushIf(
          lines,
          (en ? "Preserve " : "Preserve ") +
            keep
              .map((k) =>
                k === "pose" && ops.includes("pose")
                  ? en
                    ? "anatomically correct joint alignment (new pose)"
                    : "alinhamento anatômico das articulações (nova pose)"
                  : trans(compactProtect, k, lang),
              )
              .join(", ") +
            ".",
        );
    } else {
      keep.forEach((k) =>
        pushIf(lines, preservePhrase(k, lang, ops.includes("pose")) + "."),
      );
      if (strategy === "detailed" && Number(val("fidelity")) === 3)
        pushIf(
          lines,
          en
            ? "Change only the requested elements."
            : "Altere somente os elementos solicitados.",
        );
    }
    if (app.style !== "real")
      pushIf(lines, select(dict.styles, app.style) + ".");
    if (ops.includes("pose")) {
      const rule = poseRule(val("editPose"));
      if (val("poseFraming") === "preserve")
        pushIf(
          lines,
          en
            ? "Preserve the original framing as much as anatomy allows; reframe slightly rather than twist or distort the body."
            : "Preserve o enquadramento original na medida em que a anatomia permitir; reenquadre discretamente em vez de torcer ou distorcer o corpo.",
        );
      else if (rule.full)
        pushIf(
          lines,
          en
            ? "Reframe as needed to show the complete requested pose, including its support points."
            : "Reenquadre se necessário para mostrar a pose completa e seus pontos de apoio.",
        );
      else if (val("shot") !== "auto")
        pushIf(lines, select(dict.shots, val("shot")) + ".");
    } else if (val("shot") !== "auto")
      pushIf(lines, select(dict.shots, val("shot")) + ".");
  } else {
    const primary =
      actionNeedsPartner(val("action")) &&
      ["woman", "man"].includes(val("subject"))
        ? en
          ? "Primary protagonist: "
          : "Protagonista principal: "
        : "";
    pushIf(
      lines,
      primary +
        select(dict.subjects, val("subject")) +
        ". " +
        select(dict.ages, val("age")) +
        ".",
    );
    pushIf(lines, poseAdherence(val("pose"), lang, "start"));
    pushIf(lines, select(dict.env, val("environment")) + ".");

    if (val("wardrobe") === "figure_study" && !$("fictionalGenerate").checked)
      pushIf(
        lines,
        en
          ? "Artistic nude option not applied until adult fictional character confirmation is checked."
          : "Opção de nu artístico não aplicada até marcar a confirmação de personagem adulto fictício.",
      );
    else pushIf(lines, select(dict.wardrobe, val("wardrobe")) + ".");
    pushIf(lines, getPose(val("pose"), lang) + ".");
    if (val("action") !== "none")
      pushIf(lines, getAction(val("action"), lang) + ".");
    pushIf(lines, partnerRequirement(val("action"), lang, false));
    if (val("camera") !== "auto")
      pushIf(lines, select(dict.cameras, val("camera")) + ".");
    if (val("shot") !== "auto")
      pushIf(lines, select(dict.shots, val("shot")) + ".");
    pushIf(lines, select(dict.lights, val("light")) + ".");
    pushIf(lines, select(dict.styles, app.style) + ".");
  }
  if (user) {
    pushIf(lines, user);
  }

  if (!editing || ops.includes("pose") || ops.includes("action")) {
    const poseKey = editing
      ? ops.includes("pose")
        ? val("editPose")
        : ""
      : val("pose");
    const actionKey = editing ? "" : val("action");
    pushIf(lines, getAnatomyGuidance(poseKey, lang, actionKey));
    pushIf(lines, poseAdherence(poseKey, lang, "end"));
  }
  pushIf(
    lines,
    en
      ? "Natural anatomy, realistic texture, coherent perspective and shadows."
      : "Anatomia natural, textura realista, perspectiva e sombras coerentes.",
  );
  if (app.style === "anime")
    pushIf(
      lines,
      en
        ? "Apply the requested anime aesthetic consistently; do not inadvertently mix photorealistic skin with anime line art."
        : "Aplique o estilo anime de forma consistente; não misture inadvertidamente pele fotorrealista com traço de anime.",
    );
  return lines
    .map((x) => x.replace(/^- /, ""))
    .join(strategy === "detailed" ? "\n\n" : "\n");
}

// Rótulos das opções necessários para inicializar a interface.

const newEnvironments = {
  beach: "Praia · areia e mar",
  terrace: "Terraço · vista da cidade",
  pool: "Piscina externa",
  library: "Biblioteca · estantes de madeira",
  kitchen: "Cozinha moderna",
  forest: "Floresta · trilha natural",
  hotel: "Quarto de hotel",
  raincity: "Rua urbana · chuva",
  brickstudio: "Estúdio · parede de tijolos",
  dressing: "Camarim · espelho iluminado",
};

const newOutfits = {
  blackdress: "Vestido midi preto · alças finas",
  linen: "Camisa branca + calça bege · linho",
  denim: "Jaqueta jeans + camiseta + calça preta",
  skirt: "Blusa marfim + saia plissada preta",
  leather: "Jaqueta de couro + camiseta + jeans",
  sweater: "Suéter creme + calça cinza",
};

const newExpressions = {
  laugh: "Riso natural",
  thoughtful: "Pensativo · olhar desviado",
  serious: "Sério · sem sorriso",
  eyesclosed: "Olhos fechados · relaxado",
  surprise: "Surpresa discreta",
  coy: "Sorriso discreto · olhar de lado",
};

const outfitNames = {
  elegant: "Blazer bege + blusa marfim + calça escura",
  casual: "Camiseta branca + jeans azul",
  formal: "Terno azul-marinho + camisa branca",
  sports: "Camiseta esportiva + jogger preta",
  evening: "Vestido longo de cetim vinho",
};
