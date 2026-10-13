// The CRM pages open only for the agency; the login page is always reachable.
import { staffSignedIn } from "../../server/sessions.js";
import { gate } from "../../server/gate.js";

export const onRequest = (context) => gate(context, ["/crm/login"], (request, env) => staffSignedIn(request, env));
