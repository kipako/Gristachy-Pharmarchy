# Storefront configuration

`storefront.json` holds non-secret, public storefront configuration:

- temporary public brand display values;
- TZS/locale formatting;
- validated theme colors;
- catalog publication state; and
- public-operations publication state.

The current configuration uses the approved provisional display name **Gristachy Pharmarchy**. Public contact, delivery, service-area, and operating-hour fields intentionally remain unpublished until approved details are supplied. When `operations.publicationStatus` is `not_published`, `/api/storefront` deliberately returns only the public status and message; it omits all operations fields even if editable template values exist in the file.

The application validates this file at startup. `STOREFRONT_CONFIG_FILE` may point to an alternative non-secret configuration file for a controlled environment. Do not put passwords, API keys, customer data, prescription data, or private operational information in this directory. Runtime secrets belong in the deployment platform’s secret manager, not a configuration file.
