let _isAdminAuthenticated = false;

const originalFetch = globalThis.fetch;

export function setAdminAuthenticated(value: boolean): void {
  _isAdminAuthenticated = value;

  if (value) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes("/api/admin")) {
        const headers = new Headers(init?.headers);
        headers.set("x-admin-auth", "authenticated");
        return originalFetch(input, { ...init, headers });
      }
      return originalFetch(input, init);
    };
  } else {
    globalThis.fetch = originalFetch;
  }
}

export function isAdminAuthenticated(): boolean {
  return _isAdminAuthenticated;
}
