// Entry previews for Sveltia CMS.
//
// The CMS renders these React components inside a sandboxed iframe that loads
// /admin/preview.css — the site's own stylesheet — so an entry is written
// against the layout it will actually be published in, not a field dump.
// Markup mirrors src/pages/journal/[slug].astro, src/pages/experience/[id].astro
// and the cards those pages are listed on.
(function () {
  var h = window.h;
  var CMS = window.CMS;

  if (!CMS || !h) return;

  CMS.registerPreviewStyle("/admin/preview.css");

  var PHOTO_DIR = "/src/assets/experiences/";
  var EXTENSIONS = [".jpeg", ".jpg", ".png", ".webp", ".avif"];

  // Category labels and the default cancellation line, served by
  // src/pages/admin/preview.json.ts. It lands long before an entry is opened;
  // until then the helpers below fall back to what they were given.
  var site = { categories: [], cancellationDefault: "" };

  fetch("/admin/preview.json")
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      site = data;
    })
    .catch(function () {
      /* The preview still renders, with the raw category slug. */
    });

  function categoryName(slug) {
    var found = site.categories.filter(function (category) {
      return category.slug === slug;
    })[0];

    return found ? found.name : slug;
  }

  // Content refers to a photo by name ("cacio-e-pepe"), the CMS writes a full
  // path. Both resolve, as in src/lib/images.ts.
  function findAsset(getAsset, value) {
    if (!value) return null;

    var candidates =
      value.indexOf("/") > -1
        ? [value]
        : EXTENSIONS.map(function (extension) {
            return PHOTO_DIR + value + extension;
          });

    for (var i = 0; i < candidates.length; i += 1) {
      var asset = getAsset(candidates[i]);
      if (asset) return asset;
    }

    return null;
  }

  // An asset resolves its blob URL asynchronously, so the first render can hand
  // us a bare repository path. Poll briefly and swap it for the real one.
  var Photo = window.createClass({
    getInitialState: function () {
      return { url: String(this.props.asset) };
    },
    componentDidMount: function () {
      var self = this;

      this.timer = setInterval(function () {
        var url = String(self.props.asset);
        if (url !== self.state.url) self.setState({ url: url });
      }, 200);

      this.stop = setTimeout(function () {
        clearInterval(self.timer);
      }, 5000);
    },
    componentWillUnmount: function () {
      clearInterval(this.timer);
      clearTimeout(this.stop);
    },
    render: function () {
      return h("img", { src: this.state.url, alt: "" });
    },
  });

  // Same two states as src/components/Shot.astro: a photo, or a poster tile.
  function shot(getAsset, picture, fallbackWord) {
    var image = picture || {};
    var asset = findAsset(getAsset, image.photo);

    if (asset) return h(Photo, { asset: asset });

    return h(
      "div",
      { className: "poster p-" + (image.tone || "ink") },
      h("span", { className: "n" }, "Photo placeholder"),
      h("span", { className: "w" }, image.poster || fallbackWord),
    );
  }

  function value(entry, name) {
    var raw = entry.getIn(["data", name]);
    return raw && raw.toJS ? raw.toJS() : raw;
  }

  function label(text) {
    return h("p", { className: "lbl", style: { marginBottom: "4px" } }, text);
  }

  function JournalPreview(props) {
    var entry = props.entry;
    var title = value(entry, "title") || "Untitled";
    var date = value(entry, "date") || "";
    var cover = { photo: value(entry, "cover") };

    return h(
      "div",
      null,
      h(
        "div",
        { className: "wrap" },
        h(
          "article",
          { className: "article" },
          h(
            "p",
            { className: "crumb", style: { opacity: 1, color: "var(--muted)" } },
            "← Journal",
          ),
          h("h1", null, title),
          h("p", { className: "lbl", style: { marginTop: "12px" } }, date),
          h("div", { className: "shot" }, shot(props.getAsset, cover, "Cover")),
          props.widgetFor("body"),
        ),
      ),
      // The same article as it reads on /journal/, where the excerpt is used.
      h(
        "div",
        { className: "wrap", style: { paddingBottom: "32px" } },
        label("In the journal list"),
        h(
          "div",
          { className: "post" },
          h("div", { className: "shot" }, shot(props.getAsset, cover, "Cover")),
          h(
            "div",
            null,
            h("p", { className: "lbl" }, date),
            h("h3", null, title),
            h("p", { className: "ex" }, value(entry, "excerpt") || ""),
          ),
        ),
      ),
    );
  }

  function fact(term, description) {
    return h("div", null, h("dt", null, term), h("dd", null, description));
  }

  function ExperiencePreview(props) {
    var entry = props.entry;
    var getAsset = props.getAsset;
    var title = value(entry, "title") || "Untitled";
    var category = value(entry, "category") || "";
    var images = value(entry, "images") || [];
    var included = value(entry, "included") || [];
    var price = value(entry, "price");
    var cover = images[0] || {};

    return h(
      "div",
      null,
      h(
        "div",
        { className: "wrap" },
        h(
          "div",
          {
            className: "detail",
            // One column: the booking panel is the Bokun widget, and it only
            // runs on the live page. Capped at the width the copy gets there.
            style: { gridTemplateColumns: "minmax(0,1fr)", maxWidth: "780px" },
          },
          h(
            "div",
            null,
            h(
              "p",
              { className: "crumb", style: { opacity: 1, color: "var(--muted)" } },
              "Home / " + categoryName(category),
            ),
            h("h1", { style: { fontSize: "clamp(28px,4.6vw,54px)" } }, title),
            h(
              "p",
              {
                style: {
                  marginTop: "10px",
                  color: "var(--muted)",
                  fontSize: "15px",
                  fontWeight: 500,
                },
              },
              value(entry, "blurb") || "",
            ),
            h(
              "div",
              { className: "gal", style: { marginTop: "20px" } },
              h("div", { className: "main" }, shot(getAsset, cover, "Photo")),
              images.length > 1
                ? h(
                    "div",
                    { className: "thumbs" },
                    images.map(function (image, index) {
                      return h(
                        "button",
                        { key: index, className: index === 0 ? "on" : "", type: "button" },
                        shot(getAsset, image, "Photo"),
                      );
                    }),
                  )
                : null,
            ),
            h(
              "dl",
              { className: "facts" },
              fact("Length", value(entry, "durationLabel") || ""),
              fact("Group size", "Up to " + (value(entry, "maxGuests") || "")),
              fact("Languages", value(entry, "languages") || ""),
              fact("Meeting point", value(entry, "meetingPoint") || ""),
            ),
            h(
              "div",
              { className: "prose" },
              h("h2", null, "What you do"),
              props.widgetFor("body"),
              h("h2", null, "Included"),
              h(
                "ul",
                { className: "incl" },
                included.map(function (line, index) {
                  return h("li", { key: index }, line && line.item ? line.item : line);
                }),
              ),
              h("h2", null, "Cancellation"),
              h("p", null, value(entry, "cancellationPolicy") || site.cancellationDefault),
            ),
          ),
        ),
      ),
      // The booking column is the Bokun widget, which only runs on the live
      // page; what follows is the card this experience shows up as in the rails.
      h(
        "div",
        { className: "wrap", style: { paddingBottom: "32px" } },
        label("On the home page and category rails"),
        h(
          "div",
          { style: { maxWidth: "320px" } },
          h(
            "div",
            { className: "card" },
            h(
              "div",
              { className: "shot" },
              h("span", { className: "tag" }, categoryName(category)),
              shot(getAsset, cover, "Photo"),
            ),
            h(
              "div",
              { className: "cbody" },
              h("h3", null, title),
              h(
                "div",
                { className: "cmeta" },
                h("span", null, value(entry, "durationLabel") || ""),
                h("span", null, "max " + (value(entry, "maxGuests") || "")),
                h("span", null, value(entry, "languages") || ""),
              ),
              h(
                "div",
                { className: "cfoot" },
                h(
                  "div",
                  { className: "price" },
                  h("span", { className: "f" }, "from"),
                  h("span", { className: "v tnum" }, price ? "€" + price : "—"),
                  h("span", { className: "u" }, "/ " + (value(entry, "unit") || "person")),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  CMS.registerPreviewTemplate("journal", JournalPreview);
  CMS.registerPreviewTemplate("experiences", ExperiencePreview);
})();
