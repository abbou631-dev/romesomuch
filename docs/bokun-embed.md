> ## ⚠ Problema noto, non ancora risolto
>
> **`bokunProductId: "PRODUCT_ID"` è ancora un segnaposto in cinque esperienze del catalogo.**
> La scelta presa è di non sistemarlo ora: questo blocco serve a non farlo dimenticare.
>
> **File interessati** (verificati con `grep -rn PRODUCT_ID src/content/`):
>
> - `src/content/experiences/aperitivo.md`
> - `src/content/experiences/pasta.md`
> - `src/content/experiences/streetfood.md`
> - `src/content/experiences/tivoli.md`
> - `src/content/experiences/vatican.md`
>
> C'è anche `src/content/experiences/colosseum.md`, che ha `bokunProductId: PRODUCT_ID` senza
> virgolette, ma non è esposto al problema: quel file ha anche un `bokunEmbed` reale, e l'embed
> ha la precedenza sul product id.
>
> **Perché è un problema.** Per `src/components/Bokun.astro` il campo è solo una stringa non
> vuota, quindi viene trattato come un id valido: il componente costruisce l'URL del widget e lo
> monta, invece di mostrare il riquadro etichettato. Il risultato è un widget puntato a un prodotto
> Bokun inesistente, cioè uno spazio vuoto o un errore di Bokun, molto più difficile da
> diagnosticare del segnaposto dichiarato.
>
> **Cosa succede in produzione oggi.** Nulla di visibile: il sintomo è latente. La variabile
> `PUBLIC_BOKUN_CHANNEL` non è presente nella configurazione di Cloudflare, e senza canale il
> componente non monta nulla e mostra il riquadro etichettato. Il bug comparirà su quelle cinque
> pagine il giorno in cui la variabile verrà rimessa.
>
> **Come si risolve.** Su ciascuno dei cinque file, mettere `bokunProductId: null` (comportamento
> corretto: riquadro etichettato) oppure incollare lo snippet Bokun reale nel campo `bokunEmbed`,
> che ha comunque la precedenza.

# Aggiungere il calendario Bokun a una nuova esperienza

Questa guida spiega come collegare una nuova esperienza al calendario di prenotazione Bokun,
in modo che riceva da sola lo stesso trattamento già applicato alle altre: lo snippet viene
ripulito e montato dal componente, il canale di prenotazione viene dedotto automaticamente e
sul mobile il widget viene ridotto per stare in proporzione con la scheda di prenotazione.

Riguarda **l'embed attuale**, cioè il widget ospitato da Bokun. Vedi l'ultima sezione per il
calendario proprietario in valutazione.

I file coinvolti sono tre, e nessuno di essi va modificato per aggiungere un tour:

- `src/components/Bokun.astro` — il componente che riceve i campi e monta il widget;
- `src/content.config.ts` — lo schema che valida il frontmatter delle esperienze;
- `src/styles/global.css` — la sola regola di stile applicata al widget.

---

## 1. Da dove si prende lo snippet in Bokun

Nel pannello Bokun, alla voce **Widgets**, si sceglie il prodotto, si sceglie il tipo di widget
(per il calendario delle esperienze: *Experience calendar*) e si copia il codice con **Copy code**.

Quello che Bokun consegna ha questa forma — è esattamente lo snippet già presente su
`src/content/experiences/colosseum.md`, l'unica esperienza del catalogo che oggi abbia un embed
reale:

```html
<script type="text/javascript" src="https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID=4128ae68-652d-470e-9584-0d5493dd35c1" async></script>

<div class="bokunWidget" data-src="https://widgets.bokun.io/online-sales/4128ae68-652d-470e-9584-0d5493dd35c1/experience-calendar/1221931"></div>
<noscript>Please enable javascript in your browser to book</noscript>
```

Le parti che contano sono due, e ricorrono entrambe nello snippet:

- `bookingChannelUUID=4128ae68-...` nell'URL del loader: è il **booking channel**, cioè il canale
  di vendita. È lo stesso valore che compare come primo segmento del `data-src`.
- l'ultimo segmento del `data-src` (qui `1221931`): è il **product id** del prodotto Bokun.

Va copiato lo snippet **intero**, tag `<script>` compresi. Non serve ripulirlo a mano: ci pensa il
componente, ed è anzi preferibile lasciarlo integro, perché il canale viene letto proprio da lì.

---

## 2. Due strade per inserirlo

### a. Dal CMS, su `/admin/`

È la strada normale. Nella collezione **Experiences** si apre l'esperienza (o si crea la voce
nuova) e si incolla lo snippet nel campo **Bokun embed code**. Il campo è definito in
`public/admin/config.yml`:

```yaml
      - name: bokunEmbed
        label: Bokun embed code
        widget: text
        required: false
        hint: Paste the whole snippet Bokun gives you (Widgets → Copy code). It wins over the product ID above.
```

È un campo di testo libero e facoltativo: si incolla e si salva. Il CMS è git-based, quindi il
salvataggio è un commit sul branch di produzione e fa ripartire il deploy.

Nella stessa schermata, poco sopra, c'è **Bokun product ID** (`bokunProductId`). Compilarlo non
serve se si è già incollato lo snippet — vedi la sezione 3 sulla precedenza.

### b. A mano, nel frontmatter

Il campo è `bokunEmbed`, nel frontmatter YAML del file dell'esperienza in
`src/content/experiences/`. Un file per esperienza, il nome del file diventa l'URL
(`colosseum.md` → `/experience/colosseum/`).

Poiché lo snippet è multilinea e contiene virgolette, va scritto come blocco YAML con `|-`, con il
contenuto indentato. Estratto reale da `src/content/experiences/colosseum.md`:

```yaml
---
order: 1
title: Colosseum & Roman Forum, Skip the Line
category: tours
price: 59
unit: person
durationLabel: 3h
bokunProductId: PRODUCT_ID
bokunEmbed: |-
  <script type="text/javascript" src="https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID=4128ae68-652d-470e-9584-0d5493dd35c1" async></script>

  <div class="bokunWidget" data-src="https://widgets.bokun.io/online-sales/4128ae68-652d-470e-9584-0d5493dd35c1/experience-calendar/1221931"></div>
  <noscript>Please enable javascript in your browser to book</noscript>
---
```

(Il frontmatter completo ha altri campi obbligatori — `blurb`, `duration`, `maxGuests`,
`languages`, `meetingPoint`, `images`, `included` — che qui sono omessi per brevità. Lo schema che
li valida è in `src/content.config.ts`.)

L'unica accortezza: tutto ciò che sta sotto `bokunEmbed: |-` deve restare indentato di due spazi.
Se l'indentazione salta, il parser YAML rifiuta il file e `npm run build` si ferma.

---

## 3. Cosa succede in automatico quando lo si incolla

Il campo arriva a `src/components/Bokun.astro` attraverso `src/components/BookingPanel.astro`, che
è a sua volta incluso nella pagina di dettaglio `src/pages/experience/[id].astro`. Il componente,
in ordine:

1. **Ripulisce lo snippet.** Rimuove tutti i blocchi `<script>…</script>` dal testo incollato.
   Gli script inseriti con `set:html` non verrebbero comunque mai eseguiti dal browser, quindi
   lasciarli lì servirebbe solo a sporcare la pagina. Restano il `<div class="bokunWidget">` con il
   suo `data-src` e il `<noscript>`.
2. **Estrae il canale.** Cerca `bookingChannelUUID=…` nel testo *originale* (prima della pulizia) e
   ne prende il valore. È per questo che va incollato lo snippet intero: il canale sta nell'URL del
   `<script>` che viene poi buttato via.
3. **Sceglie il canale definitivo.** Se lo snippet contiene un UUID, vince quello. Altrimenti il
   componente ricade su `PUBLIC_BOKUN_CHANNEL`, letto dalle variabili d'ambiente al momento della
   build.
4. **Rimonta il loader.** Se il canale c'è, la pagina inietta a runtime un unico
   `<script id="bokunLoader">` che punta a
   `https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID=<canale>`.
   La guardia sull'id fa sì che il loader venga aggiunto una volta sola. È quel loader a trovare i
   `div.bokunWidget` presenti nella pagina e a sostituirli con l'iframe vero del widget.

### Quale campo vince

`bokunEmbed` ha la precedenza su `bokunProductId`. Se sono valorizzati entrambi, viene renderizzato
il markup dello snippet incollato e il product id non viene usato per costruire nulla — è
esattamente la situazione di `colosseum.md`, che ha ancora `bokunProductId: PRODUCT_ID` accanto a
un embed funzionante.

Se invece `bokunEmbed` è vuoto o assente e c'è solo `bokunProductId`, il componente costruisce da sé
il `data-src` come
`https://widgets.bokun.io/online-sales/<canale>/experience/<bokunProductId>`
e lo mette in un `div.bokunWidget` che il loader monterà.

Se non c'è né l'uno né l'altro, o manca il canale, al posto del calendario compare un riquadro
etichettato "Calendario Bokun" con una riga che spiega cosa manca. La pagina non si rompe mai.

### Cosa serve in `.env`

Solo per la strada del product id. Il file `.env.example` documenta l'unica variabile:

```
PUBLIC_BOKUN_CHANNEL=
```

Non esiste un `.env` versionato — `.env` è in `.gitignore`, va creato in locale copiando
`.env.example`. In produzione la variabile si imposta nel progetto Cloudflare Pages
(Settings → Variables and Secrets). È letta **a build time**, quindi cambiarla richiede un
redeploy perché abbia effetto.

Se si usa `bokunEmbed`, `PUBLIC_BOKUN_CHANNEL` non serve: il canale arriva dallo snippet.

---

## 4. Lo stile: cosa si può e cosa non si può toccare

Il widget Bokun non è HTML nostro. Il loader lo sostituisce con un **iframe cross-origin** servito
da `widgets.bokun.io`. Di conseguenza:

- i suoi font, i suoi colori, le sue spaziature interne, le dimensioni dei suoi bottoni **non sono
  raggiungibili dal nostro CSS**, e non lo saranno mai: il browser lo impedisce per policy di
  sicurezza, non per una nostra scelta. Chi volesse cambiarli deve farlo dal pannello Bokun, nella
  configurazione del widget o del booking channel;
- l'unica cosa che ci appartiene è il **contenitore**.

Le regole applicate sono queste. In `src/styles/global.css`, fuori da qualsiasi media query
(riga 293 circa):

```css
.bokunWidget{margin-top:14px;min-height:0}
```

E dentro il blocco `@media(max-width:640px)` che inizia intorno a riga 311 (riga 377 circa):

```css
 .book .bokunEmbed{zoom:.85}
 .book .bokunEmbed .bokunWidget{margin-top:8px}
```

`zoom:.85` è **l'unica leva applicata**, e vale solo sotto i 640px di larghezza. Il motivo, già
annotato nel CSS: `zoom` rimpicciolisce il widget renderizzato *insieme al suo box di layout*, così
l'altezza che lo script Bokun continua a scrivere sull'iframe resta coerente, e il widget continua
a impaginarsi contro un viewport interno più largo — che è ciò che gli fa mostrare i prezzi per
giorno, che in un viewport stretto nasconde. Una `transform: scale()` avrebbe rimpicciolito il
disegno lasciando invariato lo spazio occupato, con un buco sotto il calendario.

Nota: la regola ha come selettore `.book .bokunEmbed`, e la classe `.bokunEmbed` esiste **solo sul
percorso dello snippet incollato**. Un'esperienza collegata via `bokunProductId` renderizza
`.bokunWidget` senza il wrapper `.bokunEmbed`, quindi **non viene ridotta**. Oggi non fa differenza,
perché nessuna esperienza usa quella strada con un id reale.

**Come cambiare il fattore.** Si modifica il numero: `zoom:.9` riduce meno, `zoom:.8` riduce di più.

**Come disattivarlo.** Si cancella la riga `.book .bokunEmbed{zoom:.85}`, oppure la si mette a
`zoom:1`. Il widget torna a dimensione piena sul mobile.

**Come cambiare la soglia.** La riga sta dentro `@media(max-width:640px)`, un blocco che contiene
decine di altre regole mobile. Per cambiare solo la soglia del widget senza toccare tutto il resto,
conviene togliere la riga da lì e scriverla in un blocco proprio, per esempio
`@media(max-width:720px){.book .bokunEmbed{zoom:.85}}`.

---

## 5. Checklist di verifica dopo aver aggiunto un tour

1. `npm run dev` e aprire `http://localhost:4321/experience/<nome-file>/` (il nome del file senza
   `.md`).
2. Nella colonna di destra deve comparire la scheda "Book instantly" e, sotto, il calendario Bokun
   con le date. Se al suo posto si vede il riquadro grigio "Calendario Bokun", il collegamento non è
   arrivato: leggere la riga di spiegazione, dice già cosa manca.
3. Provare a scegliere una data e arrivare almeno alla schermata di riepilogo: serve a verificare
   che il product id nello snippet sia quello giusto e non il prodotto di un'altra esperienza.
4. **Prova a 390px.** Con gli strumenti da sviluppatore, larghezza 390px (iPhone). Il calendario
   deve stare dentro la scheda, senza scroll orizzontale della pagina, e devono vedersi i prezzi
   per giorno. La barra "See calendar" in fondo allo schermo deve portare al calendario.
5. `npm run check` — controlla lo schema del contenuto e i tipi. Un campo sbagliato nel frontmatter
   viene segnalato qui.
6. `npm run build` — deve completare senza errori. Se lo YAML dello snippet è indentato male, si
   ferma qui.

---

## 6. Problemi tipici e cosa significano

**Il widget non appare e al suo posto c'è il riquadro "Calendario Bokun".**
È il comportamento previsto quando manca il collegamento. Il testo dentro il riquadro distingue tre
casi: snippet incollato ma senza `bookingChannelUUID`; canale mancante del tutto; nessuno dei due
campi valorizzato. Si rilegge quella riga e si aggiunge quello che indica.

**Il riquadro c'è in locale ma la pagina funziona in produzione (o viceversa).**
Quasi sempre è `PUBLIC_BOKUN_CHANNEL`: in locale il file `.env` non esiste (non è versionato), in
produzione la variabile vive nel progetto Cloudflare Pages ed è letta a build time. Le due cose
possono divergere. Con `bokunEmbed` il problema non si pone, perché il canale viaggia col contenuto.

**Il widget appare ma il calendario è vuoto, senza date disponibili.**
Il collegamento funziona: il problema è su Bokun. Il prodotto non ha disponibilità pubblicate, non è
assegnato al booking channel dello snippet, o le date aperte sono già passate. Si verifica dal
pannello Bokun, non dal codice.

**Canale mancante in produzione.**
Le variabili su Cloudflare Pages vengono raccolte solo dai deploy creati *dopo* il salvataggio, e le
variabili di Production e Preview sono due liste distinte: è già successo che
`PUBLIC_BOKUN_CHANNEL` fosse presente in Preview e assente in Production. Dopo averla impostata,
lanciare un redeploy (Deployments → Retry deployment) e ricontrollare una pagina che usa il product
id.

**Snippet incollato con i tag `<script>`.**
Non è un problema: è il modo giusto. I tag vengono rimossi al build e il loader viene ricreato dal
componente con il canale letto proprio da quei tag. Incollare *solo* il `<div class="bokunWidget">`
senza il `<script>` è invece la cosa da non fare: senza `bookingChannelUUID` nel testo, il canale
deve arrivare da `PUBLIC_BOKUN_CHANNEL`, e se quella variabile non c'è compare il riquadro grigio.

**Prodotto con `PRODUCT_ID` segnaposto.**
Cinque file del catalogo (`aperitivo.md`, `pasta.md`, `streetfood.md`, `tivoli.md`, `vatican.md`)
hanno `bokunProductId: "PRODUCT_ID"`, e `colosseum.md` ha `bokunProductId: PRODUCT_ID` senza
virgolette. È un segnaposto scritto a mano, non un id. **Attenzione:** per il componente è una
stringa qualsiasi, quindi se `PUBLIC_BOKUN_CHANNEL` è impostata quelle esperienze non mostrano il
riquadro grigio ma provano a montare un widget verso un prodotto inesistente — il risultato è uno
spazio vuoto o un errore di Bokun, che è più difficile da diagnosticare del segnaposto. Quando si
collega davvero una di quelle esperienze, si sostituisce il valore con l'id vero o si incolla lo
snippet; finché non lo si fa, il valore corretto sarebbe `null`.

---

## 7. Stato reale del catalogo, e cosa cambierà

Al momento della scrittura, delle 19 esperienze in `src/content/experiences/`:

- **una sola ha un embed reale**: `colosseum.md`, con lo snippet del prodotto Bokun `1221931`;
- sei portano il segnaposto `PRODUCT_ID` in `bokunProductId` (`colosseum.md` compreso);
- le altre tredici hanno `bokunProductId: null` e nessun `bokunEmbed`, quindi mostrano il riquadro
  etichettato.

Va inoltre segnalata un'incoerenza nota, da sistemare quando si collegherà una seconda esperienza
per product id: lo snippet che Bokun consegna per il calendario usa un `data-src` della forma
`…/online-sales/<canale>/experience-calendar/<id>`, mentre l'URL che il componente costruisce da
`bokunProductId` usa `…/online-sales/<canale>/experience/<id>`. Sono due tipi di widget diversi. Il
percorso `bokunEmbed` non ne risente, perché usa l'URL che arriva da Bokun così com'è.

**Il calendario proprietario.** È in valutazione un motore di prenotazione fatto in casa, con
grafica nostra: esiste un prototipo con tre direzioni grafiche, e la decisione presa è che
**il pagamento resterà comunque a Bokun** (redirect al provider del canale, nessun dato di carta
che passi da noi). Le chiavi API di Bokun richiedono una firma HMAC-SHA1 e quindi non possono stare
nel browser: le chiamate passerebbero dalle Pages Functions.

Quando quel lavoro arriverà, sostituirà `src/components/Bokun.astro` e con esso tutto quanto
descritto qui. Fino ad allora questa guida resta valida, e riguarda esclusivamente l'embed attuale.
