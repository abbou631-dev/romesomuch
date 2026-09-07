# Catalogo live: dati pronti per il CMS

Questo documento raccoglie i dati delle esperienze effettivamente in vendita su Bokun e pubblicate
su `romesomuch.com` al 7 settembre 2026, nella forma dei campi del CMS (`/admin/`, collection
**Experiences**).

**Stato: già caricate.** Le sei esperienze qui sotto sono in `src/content/experiences/`, con foto
prese dal sito e calendario Bokun collegato; le 19 schede dimostrative del prototipo sono state
cancellate. Il documento resta come riferimento di ciò che è stato inserito e, soprattutto, di ciò
che manca ancora: le voci marcate *da confermare* sono lasciate vuote nel contenuto, non inventate.
Il Fiat 500 Tour non è più sul sito e non è stato caricato.

**Origine dei dati.** Titoli, descrizioni, durate, politiche di cancellazione, punti di ritrovo
e prezzi sono stati letti dai widget Bokun del canale di vendita di RomeSoMuch
(`4128ae68-652d-470e-9584-0d5493dd35c1`), cioè esattamente ciò che vede un cliente. Gli id
prodotto sono stati estratti dagli embed HTML incorporati nelle pagine di `romesomuch.com`.
Niente è stato inventato: ogni campo che Bokun non espone è elencato in fondo, nella sezione
"Dati che mancano".

**Prezzi.** I valori riportati sono quelli mostrati dal widget al 7 settembre 2026, in EUR,
comprensivi del markup del canale di vendita, e nel widget compaiono come prezzo del giorno.
Il campo `price` del CMS è un intero e sul sito viene mostrato come prezzo "da": va deciso se
usare l'arrotondamento proposto qui o il prezzo base a listino.

---

## Riepilogo

| Esperienza | Pagina attuale | ID prodotto Bokun | Prezzo widget | Durata |
|---|---|---|---|---|
| VESPA TOUR | `/vespaguidedtour` | 930925 | € 91,35 p.p. | 1h30 |
| VESPA SIDECAR TOUR | `/vespasidecartour` | 1221931 | € 142,10 p.p. | 3h |
| Roman Mosaic Workshop | `/romanmosaicclass` | 1175735 | € 96,43 p.p. | 2h30 |
| Micromosaic Jewelry Workshop | `/mosaicjewerlyclass` | 1196662 | € 131,95 p.p. | 2h30 |
| Exclusive Private Cruise on Tiber River | `/cruise-tiber-aperitivo` | 1266918 | € 603,93 a barca | 1h |
| PASTA COOKING CLASS | `/cookingclass` | 1020096 | € 91,35 p.p. | 2h |

Il canale di vendita è lo stesso per tutte, quindi lo snippet da incollare nel campo
**Bokun embed code** cambia solo per l'id finale. Modello:

```html
<script type="text/javascript" src="https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID=4128ae68-652d-470e-9584-0d5493dd35c1" async></script>
<div class="bokunWidget" data-src="https://widgets.bokun.io/online-sales/4128ae68-652d-470e-9584-0d5493dd35c1/experience-calendar/ID_PRODOTTO"></div>
<noscript>Please enable javascript in your browser to book</noscript>
```

Compilato l'embed, il campo **Bokun product ID** può restare vuoto: l'embed ha la precedenza e
porta con sé il canale, quindi funziona anche senza `PUBLIC_BOKUN_CHANNEL` in produzione.

---

## 1. Vespa Tour — `vespa-tour.md`

| Campo CMS | Valore |
|---|---|
| Order | 1 |
| Title | VESPA TOUR |
| Category | Tours |
| Blurb | Our Vespa tour is the perfect way to see Rome like a local! |
| Price (€) | 91 |
| Price unit | Per person |
| Duration (hours) | 1.5 |
| Duration label | 90min |
| Max guests | *da confermare* |
| Languages | EN · IT · RU |
| Meeting point | Via Cavour 207, 00184 Roma |
| Cancellation policy | Refund if cancelled at least 2 days before the event |
| Bokun product ID | 930925 |

**What's included**

- Vespa ride with experienced local guide
- Guided city tour
- Tiramisu tasting at Two Sizes (Piazza Navona)

**What you do (corpo del testo)**

> Ride through the streets of Rome like a true local on the back of a classic Vespa, driven by a
> friendly local guide! You'll explore the city's most iconic sights and hidden gems, all while
> soaking in stories, views, and the breeze of the Eternal City.
>
> Along the way, we'll stop at Two Sizes, one of the best tiramisu spots in Rome, to enjoy a
> delicious break with this iconic Italian dessert.
>
> This tour is perfect for those who want to see Rome with style and flavor, guided by someone who
> knows the city inside out.
>
> **Route:** Colosseum · Circus Maximus · Orange Garden · Gianicolo Hill · Fontana dell'Acqua Paola ·
> drop-off at Piazza Navona with tiramisu tasting at Two Sizes. Su richiesta, e se possibile, anche
> Pantheon e Piazza Venezia.
>
> **Please note:** not suitable for pregnant women, wheelchair users and toddlers. Minimum age 8.
> No international licence of any kind is needed: the Vespa is driven by the guide.

Altri dati dal widget: tipo esperienza "Day tour / activity", prenotazione con cut-off di 1 giorno,
difficoltà "Easy", categorie Bokun "City Tours", "Adults Only", "Couples".

---

## 2. Vespa Sidecar Tour — `vespa-sidecar-tour.md`

| Campo CMS | Valore |
|---|---|
| Order | 2 |
| Title | VESPA SIDECAR TOUR |
| Category | Tours |
| Blurb | The most stylish way to fall in love with the Eternal City |
| Price (€) | 142 |
| Price unit | Per person |
| Duration (hours) | 3 |
| Duration label | 3h |
| Max guests | *da confermare* |
| Languages | *da confermare* |
| Meeting point | Piazza di San Pantaleo, 00186 Roma |
| Cancellation policy | Refund if cancelled at least 2 days before the event |
| Bokun product ID | 1221931 |

**What's included**

- Classic Vespa sidecar ride
- Local driver and guide in one
- Pickup and drop-off at your location
- Gelato at the Pantheon

**What you do**

> Hop into a classic Vespa sidecar and explore the Eternal City in true Italian style! With a local
> guide who's also your driver, you'll cruise past Rome's most iconic landmarks while discovering
> hidden stories and soaking up the atmosphere along the way.
>
> Stop at breathtaking viewpoints, ancient monuments, and charming piazzas — all while riding one of
> Rome's most fun and memorable ways to get around.
>
> Whether it's your first time in Rome or your tenth, this experience will show you the city from a
> whole new angle: stylish, intimate, and 100% Italian.
>
> **Route:** Colosseum · Castel Sant'Angelo · St. Peter's Square · Fontana dell'Acqua Paola ·
> Pantheon, with gelato.

Altri dati dal widget: cut-off 12 ore, difficoltà "Easy", categoria Bokun "City Tours".

**Attenzione:** questo è l'unico embed reale già presente nel repository, ma si trova nel file
sbagliato — `src/content/experiences/colosseum.md`, che si chiama e si descrive come una visita al
Colosseo. Va spostato su questa esperienza.

---

## 3. Tiber Cruise — `tiber-cruise.md`

| Campo CMS | Valore |
|---|---|
| Order | 3 |
| Title | EXCLUSIVE PRIVATE CRUISE TOUR ON TIBER RIVER |
| Category | Tours |
| Blurb | Rome's only private cruise of its kind |
| Price (€) | 604 |
| Price unit | Per group (flat) |
| Duration (hours) | 1 |
| Duration label | 1h |
| Max guests | 6 |
| Languages | EN *(la hostess è dichiarata English-speaking; da confermare se c'è anche IT)* |
| Meeting point | Ponte Regina Margherita — The Boat by Gregory's |
| Cancellation policy | Refund if cancelled at least 2 days before the event |
| Bokun product ID | 1266918 |

**What's included**

- Private cruise aboard Stradivaria, up to 6 guests
- Expert skipper and English-speaking hostess
- Direct vehicle access to the dock (taxi or private car)
- Onboard assistance available on request

**What you do**

> Glide down the Tiber aboard Stradivaria, the only hand-carved private cruise boat of its kind in
> Rome, guided by an expert skipper who knows every bend of the river. You'll sail past the city's
> most iconic landmarks, soaking in 2,779 years of history, golden light, and the timeless charm of
> the Dolce Vita.
>
> Along the way, you can elevate your cruise with an Italian Gourmet Basket by The Boat by
> Gregory's — premium cold cuts, artisanal cheeses, and a curated wine selection, perfect for
> raising a glass as the sun sets over the Eternal City.
>
> This experience is perfect for romantic couples, groups of friends, or families who want to see
> Rome from a perspective almost no one else gets to enjoy.
>
> **Route:** boarding at Ponte Regina Margherita (The Boat by Gregory's) · Ponte Sant'Angelo ·
> Ponte Sisto · Risorgimento bridges · Isola Tiberina · return to Ponte Regina Margherita.

Il prezzo del widget è il totale della barca, non il prezzo a persona: per questo `unit` è
**Per group (flat)**. Il paniere gourmet è un extra a pagamento, non incluso nel prezzo base.
Altri dati dal widget: cut-off 1 giorno, difficoltà "Easy".

---

## 4. Pasta Cooking Class — `pasta-cooking-class.md`

| Campo CMS | Valore |
|---|---|
| Order | 4 |
| Title | PASTA COOKING CLASS |
| Category | Foodie |
| Blurb | Fresh pasta and sauces from scratch, the traditional way |
| Price (€) | 91 |
| Price unit | Per person |
| Duration (hours) | 2 |
| Duration label | 2h |
| Max guests | *da confermare* |
| Languages | *da confermare* |
| Meeting point | Chinappi Seafood Restaurant, Via Augusto Valenziani, 00187 Roma |
| Cancellation policy | Refund if cancelled at least 2 days before the event |
| Bokun product ID | 1020096 |

**What's included**

- Light welcoming aperitivo
- Hands-on cooking class
- Hands-on tiramisu class
- Drinks (wine or soft drinks)
- Pasta meal, lunch or dinner: you eat what you prepared

**What you do**

> Get your hands dirty and your taste buds delighted in this fun and authentic pasta-making cooking
> class in the heart of Rome! Under the guidance of a local chef, you'll learn how to make fresh
> pasta from scratch, using traditional techniques passed down through generations. No experience
> needed — just bring your appetite and enthusiasm!
>
> As your pasta rests, enjoy a welcoming aperitivo tasting, prepare fresh pasta and tiramisu. Then,
> sit down and savour the meal you created — served with your freshly made pasta and plenty of
> laughter.
>
> It's the perfect hands-on experience to dive into Italy's culinary traditions and bring a taste of
> Rome home with you!
>
> **Please note:** the pasta prepared during this experience contains common allergens such as
> gluten, eggs and dairy. It is not suitable for people with coeliac disease or who cannot eat
> pasta for dietary reasons. Please tell us about allergies or intolerances in advance.

Nel testo Bokun compare anche "PAYMENT AT ARRIVAL MUST BE IN CASH". Va deciso se tenerlo sul sito:
è in contraddizione con il pagamento con carta gestito da Bokun, e sulla scheda del sito rischia di
confondere. Chiedere al partner a cosa si riferisca (probabilmente a un extra pagato in loco).

Altri dati dal widget: cut-off 1 giorno, difficoltà "Easy", categorie Bokun "Classes / Workshops",
"Family Friendly".

---

---

## 5. Roman Mosaic Workshop — `roman-mosaic-class.md`

| Campo CMS | Valore |
|---|---|
| Order | 5 |
| Title | Roman Mosaic Workshop in an Authentic Artisan Studio |
| Category | Activities |
| Blurb | Create your own Roman mosaic using ancient techniques |
| Price (€) | 96 |
| Price unit | Per person |
| Duration (hours) | 2.5 |
| Duration label | 2h30 |
| Max guests | *da confermare* |
| Languages | *da confermare* |
| Meeting point | Via Urbana 98, 00184 Roma |
| Cancellation policy | Refund if cancelled at least 2 days before the event |
| Bokun product ID | 1175735 |

**What's included**

- Guided mosaic workshop with a local artisan
- All materials, including natural marble tesserae
- A personalised 7 x 5 inch mosaic to take home
- Coffee or bottled water

**What you do**

> Step into an authentic mosaic studio in Rome and discover the ancient art of Roman mosaics through
> a hands-on workshop. Learn traditional techniques used for centuries, work with natural marble
> tesserae, and craft your own unique mosaic masterpiece. A local artisan will guide you through the
> process, allowing you to experience a timeless craft and take home a beautiful handmade piece.
>
> **Suitable for:** participants aged 12 and above.

Altri dati dal widget: cut-off 4 ore, difficoltà "Easy", categoria Bokun "Classes / Workshops".

---

## 6. Micromosaic Jewelry Workshop — `micromosaic-jewelry-class.md`

| Campo CMS | Valore |
|---|---|
| Order | 6 |
| Title | Micromosaic Jewelry Workshop |
| Category | Activities |
| Blurb | Make your own silver micromosaic pendant in a Roman studio |
| Price (€) | 132 |
| Price unit | Per person |
| Duration (hours) | 2.5 |
| Duration label | 2h30 |
| Max guests | *da confermare* |
| Languages | *da confermare* |
| Meeting point | *da confermare* (il widget non espone la scheda "Meeting points"; è plausibile lo stesso studio di Via Urbana 98, ma va confermato) |
| Cancellation policy | Refund if cancelled at least 2 days before the event |
| Bokun product ID | 1196662 |

**What's included**

- Introduction to Roman micromosaic technique and history
- Your choice of a high-quality silver pendant frame with a chain
- Access to premium micromosaic materials and tools
- Your own finished micromosaic pendant informed by historical techniques
- A sturdy jewelry box for storing your artwork
- Bottled water, coffee and/or tea

**What you do**

> Create your own unique and timeless micromosaic jewelry piece set in silver by learning
> traditional Roman micromosaic techniques in a professional mosaic studio in Rome.
>
> With a master mosaicist by your side, you'll get hands-on experience crafting a micromosaic
> pendant that's the perfect keepsake from your time in Rome. Kick things off with a fun intro to
> the history behind Roman micromosaics.
>
> Then, pick out your favourite from a selection of high-quality silver pendant shapes, all designed
> by professional goldsmiths just for this workshop. You'll learn the basics of texture, composition,
> and how to cut glass tiles, so you can dream up and design your very own unique pendant.
>
> Our expert will be there to share helpful tips and give you all the support you need to create
> something truly special. No experience needed — just bring your curiosity and get ready to make
> some art!
>
> **Please note:** not suitable for children under 12.

Altri dati dal widget: cut-off 10 ore, difficoltà "Easy".

---

## Fiat 500 Tour — escluso

Il prodotto Bokun 930927 esiste (il documento del widget si intitola "FIAT500 TOUR") ma il widget
non renderizza nulla, né nella versione `experience` né in `experience-calendar`. Le cause tipiche
sono un prodotto disattivato, non assegnato al canale di vendita, oppure senza disponibilità futura.
L'esperienza non è più offerta e non è stata caricata sul sito. Se un giorno torna, la scheda si
ricrea con l'id 930927 e lo snippet standard.

---

## Dati che mancano e che solo tu puoi darmi

1. **Numero massimo di partecipanti** per cinque esperienze su sei. Bokun non lo espone nel widget;
   sta nella scheda prodotto del pannello. Per la crociera è dichiarato: 6. Finché il campo resta
   vuoto, la riga "Group size" non compare sulla pagina.
2. **Lingue** per cinque esperienze su sei. Solo il Vespa Tour le dichiara (English, Italian,
   Russian). Il campo del CMS è testo libero nel formato `EN · IT · ES`.
3. **Punto di ritrovo del Micromosaic Jewelry Workshop**, che Bokun non pubblica.
4. **Foto e video ad alta risoluzione.** Cinque foto per esperienza (tre per il micromosaico) più
   il video verticale dove esiste, tutto preso da `romesomuch.com`. I sorgenti sono scatti da
   telefono in verticale: foto larghe **1290 px**, video **1080x1920**. La galleria della scheda è
   costruita su quella forma: nella banda la tessera grande è alta al massimo 560px e larga circa
   480, dentro quello che i file contengono; il lightbox non supera mai la risoluzione del sorgente.
   Con originali più grandi si può solo alzare l'altezza della banda in `global.css` (`.mosaic`).
5. **Prezzo da mostrare.** I valori caricati sono quelli del widget, markup del canale incluso,
   arrotondati all'intero. Se sul sito vuoi mostrare il prezzo base di listino, servono i prezzi
   presi dal pannello Bokun.
6. **La nota "PAYMENT AT ARRIVAL MUST BE IN CASH"** della Pasta Cooking Class: non è stata riportata
   sul sito perché contraddice il pagamento con carta gestito da Bokun. Da chiarire col partner.

## Cosa è cambiato nel repository

- Le 19 esperienze dimostrative del prototipo sono state cancellate, insieme alle loro foto
  (restano `window-dome`, `cacio-e-pepe` e `steering-wheel`, usate dalla home e dal Journal), e con
  loro decade il problema noto del segnaposto `PRODUCT_ID`.
- Le sei esperienze reali sono in `src/content/experiences/` con gli slug `vespa-tour`,
  `vespa-sidecar-tour`, `tiber-cruise`, `pasta-cooking-class`, `roman-mosaic-class`,
  `micromosaic-jewelry-class`, e `topPicks` in `src/data/site.json` elenca le stesse sei.
- Le foto vengono dalle pagine di `romesomuch.com`, esportate a qualità 92 e ridotte solo se più
  larghe di 2400px: 5 per esperienza, 3 per il micromosaico.
- La scheda apre con una **banda di media a tutta larghezza** (`src/components/Gallery.astro`):
  quattro tessere **9:16**, la forma in cui i file sono stati girati. Sotto i 900px diventano due;
  sotto i 700px la banda diventa una **striscia scorrevole** con scroll-snap: le tessere sono alte
  al massimo `min(54vh, 440px)` (un 9:16 a tutta larghezza si mangiava lo schermo del telefono),
  la striscia esce fino ai bordi dello schermo con margini negativi, e la foto successiva si vede
  già di lato — così si capisce che si scorre. I due pulsanti stanno in fila sotto. Cliccandone una si apre il lightbox, che mostra il file
  intero (`object-fit:contain`) con frecce, Esc e contatore.
- Se il primo elemento è un video, **parte da solo all'apertura della pagina**, muto e in loop; il
  pulsante "Sound off" in basso a sinistra accende l'audio. Un IntersectionObserver mette in pausa
  la clip quando esce dallo schermo. Le altre tessere mostrano il fotogramma di copertina.
- Le schede accettano un **video** come primo elemento della galleria. I cinque video verticali del
  sito sono in `public/media/<slug>.mp4` (1080x1920, H.264/AAC, 6–14 MB l'uno) con il fotogramma di
  copertina in `<slug>-poster.jpg`. Nel CMS il campo Photos ha ora due tipi, *Photo* e *Video*, e il
  video si carica direttamente da lì. Le card delle liste usano sempre la prima **foto**, mai il
  video, così restano immagini ottimizzate.
- `maxGuests`, `languages` e `meetingPoint` sono diventati facoltativi nello schema e nel CMS: dove
  il dato non c'è, la riga sparisce dalla scheda invece di mostrare "Up to" seguito dal nulla.
- Le categorie in navigazione e in home vengono ora dal contenuto: **Day Trips** non compare finché
  non esiste un'esperienza in quella categoria, così il chip non porta più a una pagina vuota.
