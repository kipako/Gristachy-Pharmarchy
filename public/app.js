const appRoot = document.querySelector("#app");
const cartCount = document.querySelector("#cart-count");
const toast = document.querySelector("#toast");
const fallbackStorefront = Object.freeze({
  brand: {
    displayName: "Gristachy Pharmarchy",
    shortName: "Gristachy",
    tagline: "Review-first pharmacy"
  },
  theme: {
    primaryColor: "#0B696A",
    primaryDarkColor: "#075253",
    accentColor: "#F4B942"
  },
  locale: { currency: "TZS", locale: "en-TZ" },
  catalog: { publicationStatus: "template_only" },
  operations: {
    publicationStatus: "not_published",
    publicMessage:
      "Public contact, service area, delivery, and operating-hour information are being prepared and will be published only after approval."
  }
});

function createCurrencyFormatter(locale, currencyCode) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0
  });
}

let currency = createCurrencyFormatter(
  fallbackStorefront.locale.locale,
  fallbackStorefront.locale.currency
);
const storageKey = "pharmarchy.demo.cartId";
const staffCsrfStorageKey = "pharmarchy.demo.staffCsrf";

const state = {
  cart: null,
  categories: [],
  storefront: fallbackStorefront,
  staff: null,
  staffCsrfToken: null,
  toastTimer: null
};

class ApiError extends Error {
  constructor(message, code = "REQUEST_FAILED", details = [], status = null) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;"
      })[character]
  );
}

function formatTzs(value) {
  return currency.format(value || 0).replace(/\u00a0/g, " ");
}

function applyStorefrontConfiguration(storefront) {
  state.storefront = storefront;
  currency = createCurrencyFormatter(storefront.locale.locale, storefront.locale.currency);
  document.documentElement.lang = storefront.locale.locale;
  document.documentElement.style.setProperty("--primary", storefront.theme.primaryColor);
  document.documentElement.style.setProperty("--primary-dark", storefront.theme.primaryDarkColor);
  document.documentElement.style.setProperty("--accent", storefront.theme.accentColor);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", storefront.theme.primaryColor);
  document.title = `${storefront.brand.displayName} — pharmacist review first`;

  const textTargets = [
    ["#header-brand-name", storefront.brand.displayName],
    ["#footer-brand-name", storefront.brand.displayName],
    ["#footer-brand-inline", storefront.brand.displayName],
    ["#header-brand-tagline", storefront.brand.tagline],
    ["#footer-brand-tagline", storefront.brand.tagline],
    ["#operations-message", storefront.operations.publicMessage]
  ];
  for (const [selector, text] of textTargets) {
    const element = document.querySelector(selector);
    if (element) element.textContent = text;
  }
  const brandLink = document.querySelector("#header-brand-link");
  if (brandLink) brandLink.setAttribute("aria-label", `${storefront.brand.displayName} home`);
}

async function loadStorefrontConfiguration() {
  try {
    applyStorefrontConfiguration(await api("/api/storefront"));
  } catch {
    applyStorefrontConfiguration(fallbackStorefront);
  }
}

function productGlyph(product) {
  if (product.requiresPrescription) return "Rx";
  if (product.category?.slug === "pain-relief") return "◒";
  if (product.category?.slug === "wellness-vitamins") return "C+";
  if (product.category?.slug === "first-aid-devices") return "✚";
  return "●";
}

function savedCartId() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function saveCartId(cartId) {
  try {
    localStorage.setItem(storageKey, cartId);
  } catch {
    // The experience still works for this browser session if storage is unavailable.
  }
}

function clearCartId() {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

function savedStaffCsrfToken() {
  try {
    return sessionStorage.getItem(staffCsrfStorageKey);
  } catch {
    return null;
  }
}

function saveStaffCsrfToken(token) {
  try {
    sessionStorage.setItem(staffCsrfStorageKey, token);
  } catch {
    // A fresh token can still be obtained while the browser session is active.
  }
}

function clearStaffState() {
  state.staff = null;
  state.staffCsrfToken = null;
  try {
    sessionStorage.removeItem(staffCsrfStorageKey);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");

  let response;
  try {
    response = await fetch(path, { ...options, credentials: "same-origin", headers });
  } catch {
    throw new ApiError(
      "We could not reach the demo service. Check that the server is running.",
      "NETWORK_ERROR"
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message || "The request could not be completed.",
      payload.error?.code,
      payload.error?.details || [],
      response.status
    );
  }
  return payload.data;
}

function setStaffSession(session) {
  state.staff = session.staff;
  state.staffCsrfToken = session.csrfToken;
  if (session.csrfToken) saveStaffCsrfToken(session.csrfToken);
}

async function loadStaffSession() {
  try {
    const session = await api("/api/staff/auth/me");
    setStaffSession(session);
    return state.staff;
  } catch (error) {
    if (error.code === "STAFF_AUTH_REQUIRED" || error.status === 401) {
      clearStaffState();
      return null;
    }
    throw error;
  }
}

async function staffMutation(path, options = {}) {
  const csrfToken = state.staffCsrfToken || savedStaffCsrfToken();
  if (!csrfToken) {
    throw new ApiError(
      "Your staff session has expired. Please sign in again.",
      "CSRF_TOKEN_INVALID",
      [],
      403
    );
  }
  const headers = new Headers(options.headers || {});
  headers.set("X-CSRF-Token", csrfToken);
  return api(path, { ...options, headers });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 4400);
}

function updateCartBadge() {
  const count = state.cart?.itemCount || 0;
  cartCount.textContent = String(count);
  cartCount.setAttribute("aria-label", `${count} item${count === 1 ? "" : "s"} in cart`);
}

async function loadCart() {
  const cartId = savedCartId();
  if (!cartId) {
    state.cart = null;
    updateCartBadge();
    return null;
  }
  try {
    state.cart = await api(`/api/carts/${encodeURIComponent(cartId)}`);
    if (state.cart.status !== "active") {
      clearCartId();
      state.cart = null;
    }
  } catch (error) {
    if (error.code === "CART_NOT_FOUND" || error.code === "VALIDATION_ERROR") clearCartId();
    state.cart = null;
  }
  updateCartBadge();
  return state.cart;
}

async function ensureCart() {
  if (state.cart?.status === "active") return state.cart;
  await loadCart();
  if (state.cart?.status === "active") return state.cart;
  state.cart = await api("/api/carts", { method: "POST" });
  saveCartId(state.cart.id);
  updateCartBadge();
  return state.cart;
}

async function loadCategories() {
  if (state.categories.length > 0) return state.categories;
  state.categories = await api("/api/categories");
  return state.categories;
}

function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [pathname, search = ""] = raw.split("?");
  return {
    path: pathname.startsWith("/") ? pathname : `/${pathname}`,
    query: new URLSearchParams(search)
  };
}

function setActiveNavigation() {
  const current = route().path;
  document.querySelectorAll("[data-nav-route]").forEach((link) => {
    const target = link.dataset.navRoute;
    const active =
      (target === "home" && current === "/") ||
      (target === "shop" && (current === "/shop" || current.startsWith("/product/"))) ||
      (target === "safety" && current === "/safety") ||
      (target === "staff" && current.startsWith("/staff")) ||
      (target === "cart" && (current === "/cart" || current === "/checkout"));
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function setPageTitle(title) {
  document.title = `${title} — ${state.storefront.brand.displayName}`;
}

function productCard(product) {
  const prescription = product.requiresPrescription
    ? '<span class="rx-badge">Prescription review required</span>'
    : '<span class="rx-badge rx-badge-placeholder" aria-hidden="true">Placeholder</span>';
  return `
    <article class="product-card">
      <div class="product-art" aria-hidden="true"><span>${productGlyph(product)}</span></div>
      <div class="product-content">
        <span class="product-category">${escapeHtml(product.category.name)}</span>
        <h3><a href="#/product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h3>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <div class="product-meta">
          <span class="price">${formatTzs(product.priceTzs)}</span>
          ${prescription}
        </div>
        <div class="product-actions">
          <a class="button button-secondary button-small" href="#/product/${encodeURIComponent(product.slug)}">Details</a>
          <button class="button button-primary button-small" type="button" data-add-product="${product.id}" ${product.stockQty === 0 ? "disabled" : ""}>Add</button>
        </div>
      </div>
    </article>
  `;
}

function safetyNotice({ prescription = false } = {}) {
  const message = prescription
    ? "Prescription-required demo products need a prescription reference and explicit review consent. A pharmacist must review every request; nothing is dispensed online."
    : "This is a demo storefront. Product listing is not medical advice, availability is not guaranteed, and no payment or dispensing occurs online.";
  return `
    <aside class="notice ${prescription ? "notice-warning" : ""}" role="note">
      <span class="notice-icon" aria-hidden="true">i</span>
      <div><strong>Review-first safety boundary</strong><p>${message}</p></div>
    </aside>
  `;
}

async function renderHome() {
  setPageTitle("Pharmacist review first");
  const [products] = await Promise.all([api("/api/products"), loadCategories()]);
  const featured = products.filter((product) => product.featured).slice(0, 4);
  appRoot.innerHTML = `
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <span class="eyebrow">TZS demo catalogue</span>
          <h1>Start with a safer pharmacy request.</h1>
          <p class="hero-copy">Browse a server-backed demo catalogue, build a cart, and submit a request for pharmacist review. This foundation intentionally stops before payment, verification, and dispensing.</p>
          <div class="button-row">
            <a class="button button-primary" href="#/shop">Browse demo products</a>
            <a class="button button-secondary" href="#/safety">How the safety boundary works</a>
          </div>
        </div>
        <aside class="hero-card" aria-label="How the review process works">
          <span class="eyebrow">Transparent by design</span>
          <h2>A request is not a prescription fulfilment.</h2>
          <p>Every submitted cart is recorded as pending pharmacist review, with no payment taken.</p>
          <div class="review-steps">
            <div class="review-step"><span>1</span><div><strong>Browse demo inventory</strong><small>Products, prices, and stock are illustrative only.</small></div></div>
            <div class="review-step"><span>2</span><div><strong>Submit a review request</strong><small>Prescription items ask for a reference and review consent.</small></div></div>
            <div class="review-step"><span>3</span><div><strong>Hold before action</strong><small>A production pharmacy would apply approved clinical and operational checks.</small></div></div>
          </div>
        </aside>
      </div>
    </section>
    <section class="section section-white">
      <div class="container">
        <div class="section-heading">
          <div><span class="eyebrow">Built for a safer foundation</span><h2>Clear boundaries before commerce.</h2></div>
        </div>
        <div class="info-grid">
          <article class="info-card"><span>01</span><h3>Server-backed cart</h3><p>Product, price, stock, and cart totals are calculated on the server rather than hard-coded into a page.</p></article>
          <article class="info-card"><span>02</span><h3>Prescription checkpoint</h3><p>Prescription-required demo items cannot be submitted without a reference and explicit pharmacist-review consent.</p></article>
          <article class="info-card"><span>03</span><h3>No false checkout</h3><p>No payment or dispensing endpoint exists. Review requests remain pending until a real approved workflow is added.</p></article>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="section-heading">
          <div><span class="eyebrow">Demo inventory</span><h2>Explore the catalogue foundation.</h2><p>All data is illustrative and denominated in Tanzanian shillings.</p></div>
          <a class="text-link" href="#/shop">View all products →</a>
        </div>
        <div class="product-grid">${featured.map(productCard).join("")}</div>
      </div>
    </section>
  `;
}

async function renderShop(query) {
  setPageTitle("Demo catalogue");
  const filters = {
    q: query.get("q") || "",
    category: query.get("category") || "",
    prescription: query.get("prescription") || "all"
  };
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.prescription !== "all") params.set("prescription", filters.prescription);
  const [categories, products] = await Promise.all([
    loadCategories(),
    api(`/api/products${params.toString() ? `?${params}` : ""}`)
  ]);
  const empty = products.length === 0;
  appRoot.innerHTML = `
    <section class="page-hero"><div class="container page-heading"><span class="eyebrow">Demo catalogue</span><h1>Browse with review in mind.</h1><p>Filter demo products by category or prescription status. Listings do not replace professional advice or guarantee availability.</p></div></section>
    <section class="section"><div class="container">
      ${safetyNotice()}
      <div class="catalog-layout">
        <form class="filters" id="catalog-filters">
          <h2>Find products</h2>
          <div class="field"><label for="filter-search">Search</label><input id="filter-search" name="q" type="search" value="${escapeHtml(filters.q)}" placeholder="Product name or SKU" /></div>
          <div class="field"><label for="filter-category">Category</label><select id="filter-category" name="category"><option value="">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category.slug)}" ${filters.category === category.slug ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="filter-prescription">Prescription status</label><select id="filter-prescription" name="prescription"><option value="all" ${filters.prescription === "all" ? "selected" : ""}>All products</option><option value="otc" ${filters.prescription === "otc" ? "selected" : ""}>No prescription reference</option><option value="required" ${filters.prescription === "required" ? "selected" : ""}>Review reference required</option></select></div>
          <div class="filter-actions"><button class="button button-primary button-small" type="submit">Apply filters</button><button class="filter-reset" type="button" data-reset-filters>Clear filters</button></div>
        </form>
        <div>
          <div class="catalog-topline"><p><strong>${products.length}</strong> demo product${products.length === 1 ? "" : "s"} found</p><p>Prices in TZS</p></div>
          ${empty ? `<section class="empty-state"><div class="empty-icon" aria-hidden="true">?</div><h1>No matching products</h1><p>Try clearing a filter or using a broader search term.</p><a class="button button-primary" href="#/shop">Clear catalogue filters</a></section>` : `<div class="product-grid">${products.map(productCard).join("")}</div>`}
        </div>
      </div>
    </div></section>
  `;
}

async function renderProduct(slug) {
  const product = await api(`/api/products/${encodeURIComponent(slug)}`);
  setPageTitle(product.name);
  appRoot.innerHTML = `
    <section class="section"><div class="container">
      <p><a href="#/shop">← Back to catalogue</a></p>
      <div class="detail-layout">
        <div class="product-art detail-art" aria-hidden="true"><span>${productGlyph(product)}</span></div>
        <article class="detail-content">
          <span class="product-category">${escapeHtml(product.category.name)}</span>
          <h1>${escapeHtml(product.name)}</h1>
          ${product.requiresPrescription ? '<span class="rx-badge">Prescription review required</span>' : ""}
          <p class="detail-price">${formatTzs(product.priceTzs)}</p>
          <p class="detail-description">${escapeHtml(product.description)}</p>
          ${safetyNotice({ prescription: product.requiresPrescription })}
          <div class="detail-actions"><button class="button button-primary" type="button" data-add-product="${product.id}" ${product.stockQty === 0 ? "disabled" : ""}>${product.stockQty > 0 ? "Add to review cart" : "Unavailable"}</button><a class="button button-secondary" href="#/cart">View cart</a></div>
          <p class="stock-copy">Illustrative stock indicator: ${product.stockQty} unit${product.stockQty === 1 ? "" : "s"} shown. This is not a confirmation of availability.</p>
        </article>
      </div>
    </div></section>
  `;
}

function cartItem(item) {
  const product = item.product;
  return `
    <article class="cart-item">
      <div class="product-art cart-item-art" aria-hidden="true"><span>${productGlyph(product)}</span></div>
      <div>
        <h2><a href="#/product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h2>
        <p>${formatTzs(product.priceTzs)} each${product.requiresPrescription ? " · prescription review required" : ""}</p>
        <div class="cart-item-controls">
          <div class="quantity-control" aria-label="Quantity for ${escapeHtml(product.name)}"><button type="button" data-cart-action="decrease" data-product-id="${product.id}" aria-label="Decrease quantity">−</button><output>${item.quantity}</output><button type="button" data-cart-action="increase" data-product-id="${product.id}" aria-label="Increase quantity">+</button></div>
          <button class="remove-item" type="button" data-cart-action="remove" data-product-id="${product.id}">Remove</button>
        </div>
      </div>
      <strong class="cart-line-total">${formatTzs(item.lineTotalTzs)}</strong>
    </article>
  `;
}

function cartSummary(cart, { checkout = false } = {}) {
  return `
    <aside class="summary-card">
      <h2>Review request summary</h2>
      <div class="summary-row"><span>Items</span><strong>${cart.itemCount}</strong></div>
      <div class="summary-row"><span>Subtotal</span><strong>${formatTzs(cart.subtotalTzs)}</strong></div>
      <div class="summary-row total"><span>Estimated total</span><strong>${formatTzs(cart.subtotalTzs)}</strong></div>
      ${cart.requiresPrescription ? '<div class="notice notice-warning"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Prescription review</strong><p>Reference and consent are required before request submission.</p></div></div>' : ""}
      ${checkout ? "" : '<a class="button button-primary" href="#/checkout">Continue to review details</a>'}
      <p class="summary-note">No payment is collected. A submitted request remains pending pharmacist review and does not reserve or dispense stock.</p>
    </aside>
  `;
}

async function renderCart() {
  setPageTitle("Your cart");
  await loadCart();
  if (!state.cart?.items.length) {
    appRoot.innerHTML = `<section class="section"><div class="container"><section class="empty-state"><div class="empty-icon" aria-hidden="true">Bag</div><h1>Your review cart is empty.</h1><p>Add a demo product to see server-calculated totals and the pharmacist-review flow.</p><a class="button button-primary" href="#/shop">Browse demo products</a></section></div></section>`;
    return;
  }
  appRoot.innerHTML = `
    <section class="page-hero"><div class="container page-heading"><span class="eyebrow">Your review cart</span><h1>Check items before review.</h1><p>Cart totals are calculated by the server. This demo does not guarantee price, availability, or medicine suitability.</p></div></section>
    <section class="section"><div class="container">
      ${safetyNotice({ prescription: state.cart.requiresPrescription })}
      <div class="cart-layout"><div class="cart-list">${state.cart.items.map(cartItem).join("")}</div>${cartSummary(state.cart)}</div>
    </div></section>
  `;
}

function checkoutFields(cart) {
  const prescriptionSection = cart.requiresPrescription
    ? `
      <fieldset class="field-wide checkout-fieldset">
        <div class="notice notice-warning"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Prescription review intake</strong><p>Do not upload a prescription here. This demo records only a reference for a pharmacist to review through an approved process.</p></div></div>
        <div class="field"><label for="prescription-reference">Prescription reference</label><input id="prescription-reference" name="prescriptionReference" required maxlength="100" autocomplete="off" placeholder="e.g. approved reference" /></div>
        <div class="check-field"><input id="prescription-consent" name="prescriptionConsent" type="checkbox" required /><label for="prescription-consent">I consent to a pharmacist reviewing this request and its prescription reference. I understand this demo does not verify or dispense medication.</label></div>
      </fieldset>`
    : "";
  return `
    <form class="checkout-form" id="checkout-form" novalidate>
      <h2>Contact and delivery details</h2>
      <div class="form-grid">
        <div class="field"><label for="first-name">First name</label><input id="first-name" name="firstName" autocomplete="given-name" required maxlength="60" /></div>
        <div class="field"><label for="last-name">Last name</label><input id="last-name" name="lastName" autocomplete="family-name" required maxlength="60" /></div>
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" /></div>
        <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" required maxlength="24" placeholder="+255 …" /></div>
        <div class="field field-wide"><label for="address-line-1">Address</label><input id="address-line-1" name="addressLine1" autocomplete="street-address" required maxlength="160" /></div>
        <div class="field field-wide"><label for="address-line-2">Address line 2 <span aria-hidden="true">(optional)</span></label><input id="address-line-2" name="addressLine2" autocomplete="address-line2" maxlength="160" /></div>
        <div class="field"><label for="district">District</label><input id="district" name="district" autocomplete="address-level2" required maxlength="80" /></div>
        <div class="field"><label for="region">Region</label><input id="region" name="region" autocomplete="address-level1" required maxlength="80" /></div>
        ${prescriptionSection}
        <div class="field-wide">
          <div class="check-field"><input id="privacy-consent" name="privacyConsent" type="checkbox" required /><label for="privacy-consent">I understand this is a development demo and will not enter real prescription or sensitive patient information.</label></div>
          <div class="check-field"><input id="terms-consent" name="termsConsent" type="checkbox" required /><label for="terms-consent">I understand submission creates a pharmacist-review request only. It is not payment, a verified prescription, a clinical consultation, or a dispensing commitment.</label></div>
        </div>
      </div>
      <p id="checkout-message" class="form-message" role="alert"></p>
      <button class="button button-primary" type="submit">Submit review request</button>
    </form>
  `;
}

async function renderCheckout() {
  setPageTitle("Review details");
  await loadCart();
  if (!state.cart?.items.length) {
    appRoot.innerHTML = `<section class="section"><div class="container"><section class="empty-state"><div class="empty-icon" aria-hidden="true">!</div><h1>Add products before review.</h1><p>Your cart is empty, so there is no request to submit.</p><a class="button button-primary" href="#/shop">Browse demo products</a></section></div></section>`;
    return;
  }
  appRoot.innerHTML = `
    <section class="page-hero"><div class="container page-heading"><span class="eyebrow">Request review</span><h1>Submit details for pharmacist review.</h1><p>There is deliberately no payment step. Submission records a demo request that remains pending review.</p></div></section>
    <section class="section"><div class="container">
      ${safetyNotice({ prescription: state.cart.requiresPrescription })}
      <div class="checkout-layout">${checkoutFields(state.cart)}${cartSummary(state.cart, { checkout: true })}</div>
    </div></section>
  `;
}

function renderConfirmation(query) {
  const reference = query.get("reference") || "Request submitted";
  const containsPrescription = query.get("prescription") === "true";
  setPageTitle("Review request submitted");
  appRoot.innerHTML = `
    <section class="section"><div class="container"><section class="confirmation-card">
      <div class="confirmation-icon" aria-hidden="true">✓</div>
      <span class="eyebrow">Request recorded</span>
      <h1>Awaiting pharmacist review.</h1>
      <p>Your demo request has been recorded. No payment has been taken and no product has been dispensed.</p>
      <div class="confirmation-reference">${escapeHtml(reference)}</div>
      ${containsPrescription ? '<div class="notice notice-warning"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Prescription item included</strong><p>A valid prescription still requires review through an approved pharmacy process. This demo does not verify it.</p></div></div>' : ""}
      <div class="button-row button-row-centered"><a class="button button-primary" href="#/shop">Return to catalogue</a><a class="button button-secondary" href="#/safety">Review safety boundary</a></div>
    </section></div></section>
  `;
}

function renderSafety() {
  setPageTitle("Safety boundary");
  appRoot.innerHTML = `
    <section class="page-hero"><div class="container page-heading"><span class="eyebrow">Safety & launch gates</span><h1>Designed not to overstate what a demo can do.</h1><p>This application implements a commerce foundation, not a live pharmacy. Its boundaries are explicit in both the interface and the server.</p></div></section>
    <section class="section"><div class="container">
      <div class="safety-grid">
        <article class="safety-card"><h2>What this demo does</h2><ul><li>Lists illustrative products in TZS from a SQLite database.</li><li>Maintains a server-backed cart with stock-aware quantities and server-calculated totals.</li><li>Validates contact details and creates a request with a pending pharmacist-review status.</li><li>Requires a prescription reference and consent for prescription-required demo products.</li></ul></article>
        <article class="safety-card"><h2>What it does not do</h2><ul><li>Accept payment or hold card/mobile-money details.</li><li>Verify a prescription, offer medical advice, decide suitability, or dispense medication.</li><li>Guarantee stock, price, fulfilment, delivery, or consultation.</li><li>Provide a secure workflow for real prescription documents or patient records.</li></ul></article>
        <article class="safety-card"><h2>Controls before a real launch</h2><ul><li>Licensed pharmacy governance, approved pharmacist review procedures, and market-specific legal review.</li><li>Privacy, retention, encrypted sensitive-data handling, role-based access, audit logs, and incident response.</li><li>Approved prescription-document intake, inventory source, fulfilment process, and customer support model.</li></ul></article>
        <article class="safety-card"><h2>Technical next steps</h2><ul><li>Replace demo staff access with approved identity management, MFA, provisioning, and access reviews.</li><li>Integrate authorised product/inventory data rather than demo seed data.</li><li>Complete accessibility, security, performance, and operational testing.</li><li>Integrate payments only after compliance and fulfilment gates are approved.</li></ul></article>
      </div>
      <aside class="notice notice-warning" role="note"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Do not submit personal health or prescription information</strong><p>This local demonstration stores requests in a demo database. Use fictional data only.</p></div></aside>
    </div></section>
  `;
}

function formatDateTime(value) {
  if (!value) return "—";
  const timestamp = String(value).includes("T")
    ? String(value)
    : `${String(value).replace(" ", "T")}Z`;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-TZ", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

const reviewStatusLabels = {
  pending_pharmacist_review: "Pending pharmacist review",
  approved_for_payment: "Approved for payment (demo)",
  rejected: "Request rejected",
  cancelled: "Request cancelled"
};

function statusChip(status) {
  const label = reviewStatusLabels[status] || "Unknown status";
  const className = [
    "pending_pharmacist_review",
    "approved_for_payment",
    "rejected",
    "cancelled"
  ].includes(status)
    ? `status-${status}`
    : "status-unknown";
  return `<span class="status-chip ${className}">${escapeHtml(label)}</span>`;
}

function auditEventLabel(eventType) {
  const labels = {
    "order.submitted_for_review": "Request submitted for review",
    "order.review_approved_for_payment": "Review marked approved for payment",
    "order.review_rejected": "Review marked rejected"
  };
  return labels[eventType] || eventType.replaceAll("_", " ").replaceAll(".", " · ");
}

function renderStaffLogin() {
  setPageTitle("Demo staff console");
  appRoot.innerHTML = `
    <section class="page-hero"><div class="container page-heading"><span class="eyebrow">Protected demo area</span><h1>Staff review console.</h1><p>This local demonstration uses a protected staff session and audit trail. Do not enter real patient, prescription, or operational data.</p></div></section>
    <section class="section"><div class="container">
      <div class="staff-login-layout">
        <section class="staff-login-card">
          <span class="eyebrow">Demo pharmacist access</span>
          <h2>Sign in to review requests</h2>
          <p>Access is limited to the local demo account. Production use requires approved identity management, staff provisioning, MFA, and audit controls.</p>
          <form id="staff-login-form">
            <div class="field"><label for="staff-email">Staff email</label><input id="staff-email" name="email" type="email" autocomplete="username" required value="${escapeHtml("pharmacist@demo.pharmarchy.test")}" /></div>
            <div class="field"><label for="staff-password">Password</label><input id="staff-password" name="password" type="password" autocomplete="current-password" required /></div>
            <p id="staff-login-message" class="form-message" role="alert"></p>
            <button class="button button-primary" type="submit">Sign in to demo console</button>
          </form>
          <details class="demo-credential"><summary>Local demo credential</summary><p><strong>Email:</strong> pharmacist@demo.pharmarchy.test<br /><strong>Password:</strong> DemoPharmarchyReview2026!</p><p>These credentials are seeded only outside production mode and provide access to fictional demo data.</p></details>
        </section>
        <aside class="staff-boundary-card">
          <span class="status-chip status-pending_pharmacist_review">Review-first controls</span>
          <h2>What access does—and does not—allow.</h2>
          <ul><li>Review and document a fictional request decision.</li><li>Record a status change with an audit event.</li><li>See a request only after authenticated staff access.</li><li>Never charge, dispense, verify a prescription, or offer a clinical decision.</li></ul>
        </aside>
      </div>
    </div></section>
  `;
}

function staffOrderRows(orders) {
  if (!orders.length) {
    return '<tr><td colspan="6" class="staff-empty-cell">No requests match this status.</td></tr>';
  }
  return orders
    .map(
      (order) => `
      <tr>
        <td><a class="staff-order-reference" href="#/staff/orders/${encodeURIComponent(order.reference)}">${escapeHtml(order.reference)}</a><small>${formatDateTime(order.createdAt)}</small></td>
        <td>${escapeHtml(order.customerName)}${order.containsPrescription ? '<span class="rx-badge staff-rx-badge">Prescription</span>' : ""}</td>
        <td>${order.itemCount}</td>
        <td>${formatTzs(order.subtotalTzs)}</td>
        <td>${statusChip(order.status)}</td>
        <td><a class="button button-secondary button-small" href="#/staff/orders/${encodeURIComponent(order.reference)}">Open review</a></td>
      </tr>
    `
    )
    .join("");
}

async function renderStaff(query) {
  setPageTitle("Staff review console");
  const staff = await loadStaffSession();
  if (!staff) {
    renderStaffLogin();
    return;
  }

  const status = query.get("status") || "pending_pharmacist_review";
  const [summary, orders] = await Promise.all([
    api("/api/staff/orders/summary"),
    api(`/api/staff/orders?status=${encodeURIComponent(status)}`)
  ]);
  appRoot.innerHTML = `
    <section class="page-hero"><div class="container page-heading"><span class="eyebrow">Authenticated demo staff area</span><h1>Review queue.</h1><p>Signed in as ${escapeHtml(staff.displayName)} (${escapeHtml(staff.role)}). Decisions are logged, but remain fictional demo workflow states.</p></div></section>
    <section class="section"><div class="container">
      <div class="staff-toolbar"><div><strong>${escapeHtml(staff.displayName)}</strong><span>${escapeHtml(staff.email)}</span></div><button class="button button-secondary button-small" type="button" data-staff-logout>Sign out</button></div>
      <aside class="notice notice-warning" role="note"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Demo-only staff data</strong><p>Do not enter or use real patient, prescription, payment, or dispensing information. “Approved for payment” does not create a payment or dispense action.</p></div></aside>
      <div class="staff-summary-grid">
        <article><span>Pending</span><strong>${summary.pendingPharmacistReview}</strong></article>
        <article><span>Approved for payment</span><strong>${summary.approvedForPayment}</strong></article>
        <article><span>Rejected</span><strong>${summary.rejected}</strong></article>
        <article><span>Total requests</span><strong>${summary.total}</strong></article>
      </div>
      <section class="staff-orders-card">
        <div class="staff-orders-heading"><div><h2>Order-review requests</h2><p>Review decisions require a note, explicit acknowledgement, and a valid staff session token.</p></div>
          <form id="staff-order-filters" class="staff-filter"><label for="staff-status">Show</label><select id="staff-status" name="status">
            <option value="pending_pharmacist_review" ${status === "pending_pharmacist_review" ? "selected" : ""}>Pending review</option>
            <option value="approved_for_payment" ${status === "approved_for_payment" ? "selected" : ""}>Approved for payment</option>
            <option value="rejected" ${status === "rejected" ? "selected" : ""}>Rejected</option>
            <option value="cancelled" ${status === "cancelled" ? "selected" : ""}>Cancelled</option>
            <option value="all" ${status === "all" ? "selected" : ""}>All requests</option>
          </select><button class="button button-secondary button-small" type="submit">Update</button></form>
        </div>
        <div class="table-scroll"><table class="staff-order-table"><thead><tr><th>Reference / received</th><th>Customer</th><th>Items</th><th>Subtotal</th><th>Status</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>${staffOrderRows(orders)}</tbody></table></div>
      </section>
    </div></section>
  `;
}

function renderStaffReviewForm(order) {
  if (order.status !== "pending_pharmacist_review") {
    const reviewer = order.review?.reviewer?.name || "An authorised staff member";
    return `<section class="staff-review-card"><h2>Recorded review</h2>${statusChip(order.status)}<p><strong>Reviewer:</strong> ${escapeHtml(reviewer)}<br /><strong>Recorded:</strong> ${formatDateTime(order.review?.reviewedAt)}</p><p class="staff-note">${escapeHtml(order.review?.note || "No review note was recorded.")}</p><p class="summary-note">This recorded state does not represent a completed payment, verified prescription, or dispensing decision.</p></section>`;
  }
  return `
    <form class="staff-review-card" id="staff-decision-form" data-order-reference="${escapeHtml(order.reference)}">
      <h2>Record review decision</h2>
      <p>Use this demo control only for fictional test requests. A decision is audit logged and cannot be changed through this interface.</p>
      <div class="field"><label for="review-decision">Decision</label><select id="review-decision" name="decision"><option value="approve">Approve for payment (demo state)</option><option value="reject">Reject request</option></select></div>
      <div class="field"><label for="review-note">Review note</label><textarea id="review-note" name="note" required minlength="10" maxlength="1000" placeholder="Record a fictional review note for this demo…"></textarea></div>
      <div class="check-field"><input id="review-acknowledgement" name="acknowledgement" type="checkbox" required /><label for="review-acknowledgement">I acknowledge that this demo does not verify a prescription, make a clinical judgement, collect payment, or authorise medicine dispensing.</label></div>
      <p id="staff-decision-message" class="form-message" role="alert"></p>
      <button class="button button-primary" type="submit">Record decision</button>
    </form>
  `;
}

async function renderStaffOrder(reference) {
  setPageTitle("Staff review request");
  const staff = await loadStaffSession();
  if (!staff) {
    renderStaffLogin();
    return;
  }
  const order = await api(`/api/staff/orders/${encodeURIComponent(reference)}`);
  const addressLines = [
    order.customer.addressLine1,
    order.customer.addressLine2,
    order.customer.district,
    order.customer.region
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join("<br />");
  appRoot.innerHTML = `
    <section class="page-hero"><div class="container page-heading"><p><a href="#/staff">← Back to review queue</a></p><span class="eyebrow">Demo review request</span><h1>${escapeHtml(order.reference)}</h1><p>Received ${formatDateTime(order.createdAt)} · ${statusChip(order.status)}</p></div></section>
    <section class="section"><div class="container">
      <div class="staff-toolbar"><div><strong>${escapeHtml(staff.displayName)}</strong><span>Authenticated ${escapeHtml(staff.role)} session</span></div><button class="button button-secondary button-small" type="button" data-staff-logout>Sign out</button></div>
      <aside class="notice notice-warning" role="note"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Strict demo boundary</strong><p>Review this fictional record only. No real prescription verification, clinical decision, payment, stock reservation, or dispensing can occur from this console.</p></div></aside>
      <div class="staff-detail-layout">
        <div class="staff-detail-main">
          <section class="staff-data-card"><h2>Request details</h2><div class="staff-data-grid"><div><h3>Customer</h3><p>${escapeHtml(order.customer.firstName)} ${escapeHtml(order.customer.lastName)}<br />${escapeHtml(order.customer.email)}<br />${escapeHtml(order.customer.phone)}</p></div><div><h3>Delivery details</h3><p>${addressLines}</p></div><div><h3>Prescription intake</h3><p>${order.prescription.required ? `<span class="rx-badge">Reference required</span><br />${escapeHtml(order.prescription.reference || "Not provided")}` : "No prescription-required item in this request."}</p></div></div></section>
          <section class="staff-data-card"><h2>Requested items</h2><div class="table-scroll"><table class="staff-order-table"><thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${order.items.map((item) => `<tr><td>${escapeHtml(item.productName)}${item.requiresPrescription ? '<span class="rx-badge staff-rx-badge">Prescription</span>' : ""}</td><td>${escapeHtml(item.sku)}</td><td>${item.quantity}</td><td>${formatTzs(item.unitPriceTzs)}</td><td>${formatTzs(item.lineTotalTzs)}</td></tr>`).join("")}</tbody></table></div><div class="staff-total"><span>Request subtotal</span><strong>${formatTzs(order.subtotalTzs)}</strong></div></section>
          <section class="staff-data-card"><h2>Audit timeline</h2><ol class="audit-list">${order.audit.map((event) => `<li><div><strong>${escapeHtml(auditEventLabel(event.eventType))}</strong><span>${formatDateTime(event.createdAt)} · ${escapeHtml(event.actor?.name || "System")}</span></div></li>`).join("")}</ol></section>
        </div>
        <aside>${renderStaffReviewForm(order)}</aside>
      </div>
    </div></section>
  `;
}

async function submitStaffLogin(form) {
  const message = form.querySelector("#staff-login-message");
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Signing in…";
  message.textContent = "";
  try {
    const session = await api("/api/staff/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: data.get("email"), password: data.get("password") })
    });
    setStaffSession(session);
    location.hash = "#/staff";
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
    button.textContent = "Sign in to demo console";
  }
}

async function signOutStaff() {
  try {
    await staffMutation("/api/staff/auth/logout", { method: "POST" });
  } catch (error) {
    if (error.code !== "STAFF_AUTH_REQUIRED") showToast(error.message);
  }
  clearStaffState();
  showToast("Signed out of the demo staff console.");
  if (route().path.startsWith("/staff")) {
    await renderRoute();
  } else {
    location.hash = "#/staff";
  }
}

async function submitStaffDecision(form) {
  const message = form.querySelector("#staff-decision-message");
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Recording decision…";
  message.textContent = "";
  try {
    await staffMutation(
      `/api/staff/orders/${encodeURIComponent(form.dataset.orderReference)}/decision`,
      {
        method: "POST",
        body: JSON.stringify({
          decision: data.get("decision"),
          note: data.get("note"),
          acknowledgement: data.get("acknowledgement") === "on"
        })
      }
    );
    showToast("Demo review decision recorded in the audit trail.");
    await renderRoute();
  } catch (error) {
    message.textContent = error.details?.[0]?.message || error.message;
    button.disabled = false;
    button.textContent = "Record decision";
  }
}

function renderError(error) {
  setPageTitle("Something went wrong");
  appRoot.innerHTML = `
    <section class="section"><div class="container"><section class="error-state"><div class="empty-icon" aria-hidden="true">!</div><h1>We could not load this view.</h1><p>${escapeHtml(error.message || "Please try again.")}</p><div class="button-row button-row-centered"><a class="button button-primary" href="#/">Go home</a><button class="button button-secondary" type="button" data-retry-render>Try again</button></div></section></div></section>
  `;
}

async function renderRoute({ focus = false } = {}) {
  setActiveNavigation();
  appRoot.innerHTML = '<div class="loading" role="status" aria-label="Loading"></div>';
  const current = route();
  try {
    if (current.path === "/") await renderHome();
    else if (current.path === "/shop") await renderShop(current.query);
    else if (current.path.startsWith("/product/"))
      await renderProduct(decodeURIComponent(current.path.slice("/product/".length)));
    else if (current.path === "/cart") await renderCart();
    else if (current.path === "/checkout") await renderCheckout();
    else if (current.path === "/confirmation") renderConfirmation(current.query);
    else if (current.path === "/safety") renderSafety();
    else if (current.path === "/staff") await renderStaff(current.query);
    else if (current.path.startsWith("/staff/orders/"))
      await renderStaffOrder(decodeURIComponent(current.path.slice("/staff/orders/".length)));
    else throw new ApiError("That page does not exist.", "NOT_FOUND");
  } catch (error) {
    renderError(error);
  }
  if (focus) {
    appRoot.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

async function addProduct(productId) {
  try {
    const cart = await ensureCart();
    state.cart = await api(`/api/carts/${encodeURIComponent(cart.id)}/items`, {
      method: "POST",
      body: JSON.stringify({ productId: Number(productId), quantity: 1 })
    });
    updateCartBadge();
    showToast("Added to your review cart.");
  } catch (error) {
    showToast(error.message);
  }
}

async function changeCartItem(productId, action) {
  if (!state.cart) return;
  const item = state.cart.items.find((entry) => entry.productId === Number(productId));
  if (!item) return;
  try {
    if (action === "remove" || (action === "decrease" && item.quantity === 1)) {
      state.cart = await api(
        `/api/carts/${encodeURIComponent(state.cart.id)}/items/${item.productId}`,
        { method: "DELETE" }
      );
    } else {
      const quantity = action === "increase" ? item.quantity + 1 : item.quantity - 1;
      state.cart = await api(
        `/api/carts/${encodeURIComponent(state.cart.id)}/items/${item.productId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ quantity })
        }
      );
    }
    updateCartBadge();
    await renderRoute();
  } catch (error) {
    showToast(error.message);
  }
}

async function submitCheckout(form) {
  const message = form.querySelector("#checkout-message");
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  if (!state.cart?.id) {
    message.textContent = "Your cart is no longer available. Please return to the catalogue.";
    return;
  }
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Submitting request…";
  message.textContent = "";

  const payload = {
    cartId: state.cart.id,
    customer: {
      firstName: data.get("firstName"),
      lastName: data.get("lastName"),
      email: data.get("email"),
      phone: data.get("phone"),
      addressLine1: data.get("addressLine1"),
      addressLine2: data.get("addressLine2"),
      district: data.get("district"),
      region: data.get("region")
    },
    prescription: {
      reference: data.get("prescriptionReference") || "",
      consentToReview: data.get("prescriptionConsent") === "on"
    },
    consents: {
      privacy: data.get("privacyConsent") === "on",
      terms: data.get("termsConsent") === "on"
    }
  };

  try {
    const order = await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
    clearCartId();
    state.cart = null;
    updateCartBadge();
    location.hash = `#/confirmation?reference=${encodeURIComponent(order.reference)}&prescription=${order.containsPrescription}`;
  } catch (error) {
    const detail = error.details?.[0]?.message;
    message.textContent = detail || error.message;
    submitButton.disabled = false;
    submitButton.textContent = "Submit review request";
  }
}

appRoot.addEventListener("click", async (event) => {
  const addButton = event.target.closest("[data-add-product]");
  if (addButton) {
    await addProduct(addButton.dataset.addProduct);
    return;
  }
  const cartButton = event.target.closest("[data-cart-action]");
  if (cartButton) {
    await changeCartItem(cartButton.dataset.productId, cartButton.dataset.cartAction);
    return;
  }
  if (event.target.closest("[data-staff-logout]")) {
    await signOutStaff();
    return;
  }
  if (event.target.closest("[data-reset-filters]")) {
    location.hash = "#/shop";
    return;
  }
  if (event.target.closest("[data-retry-render]")) {
    await renderRoute();
  }
});

appRoot.addEventListener("submit", async (event) => {
  if (event.target.matches("#catalog-filters")) {
    event.preventDefault();
    const data = new FormData(event.target);
    const params = new URLSearchParams();
    if (data.get("q")) params.set("q", data.get("q").trim());
    if (data.get("category")) params.set("category", data.get("category"));
    if (data.get("prescription") && data.get("prescription") !== "all")
      params.set("prescription", data.get("prescription"));
    location.hash = `#/shop${params.toString() ? `?${params}` : ""}`;
  }
  if (event.target.matches("#checkout-form")) {
    event.preventDefault();
    await submitCheckout(event.target);
  }
  if (event.target.matches("#staff-login-form")) {
    event.preventDefault();
    await submitStaffLogin(event.target);
  }
  if (event.target.matches("#staff-order-filters")) {
    event.preventDefault();
    const data = new FormData(event.target);
    const status = data.get("status") || "pending_pharmacist_review";
    location.hash = `#/staff?status=${encodeURIComponent(status)}`;
  }
  if (event.target.matches("#staff-decision-form")) {
    event.preventDefault();
    await submitStaffDecision(event.target);
  }
});

window.addEventListener("hashchange", () => renderRoute({ focus: true }));
window.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#year").textContent = new Date().getFullYear();
  await loadStorefrontConfiguration();
  await loadCart();
  await renderRoute();
});
