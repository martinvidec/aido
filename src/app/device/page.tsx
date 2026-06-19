import DeviceConsentForm from "./DeviceConsentForm";

// Device-login consent page (issue #182, epic #186). Opened on the trusted second
// device (phone on cellular). The user signs in with the existing Firebase Google
// login, enters the user_code shown on the work machine and approves — which lets
// the work machine's poller obtain a Firebase custom token. The server validates
// the code at confirm time, so this page only needs to forward the (optional)
// prefilled user_code to the client form.

export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return <DeviceConsentForm initialUserCode={first(sp.user_code)} />;
}
