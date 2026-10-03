// One address for the whole site. www.romesomuch.com served the same pages as
// romesomuch.com, so search engines saw two sites and Google's result kept the
// www copy with no icon. Every www request now moves to the bare domain.
export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname === "www.romesomuch.com") {
    url.hostname = "romesomuch.com";
    return Response.redirect(url.toString(), 301);
  }
  return next();
};
