import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const paymentKindSchema = z.enum(["crypto", "bank"]);
const countrySchema = z.enum(["BR"]);
const localeSchema = z.enum(["pt-BR"]);

export const runtimeBrandConfigSchema = z.object({
  id: nonEmptyString,
  companyName: nonEmptyString,
  headline: nonEmptyString,
  subheadline: nonEmptyString,
  fiatCurrency: nonEmptyString,
  transactionalCapFiat: z.number().positive(),
  primaryColor: nonEmptyString,
  supportEmail: nonEmptyString,
  legalDisclaimer: nonEmptyString,

  defaultLocale: localeSchema,
  defaultCountry: countrySchema,
  enabledCountries: z.array(countrySchema).min(1),
  enabledPaymentKinds: z.array(paymentKindSchema).min(1),

  bankLabelByCountry: z.object({
    BR: nonEmptyString
  }),

  documentTypesByCountry: z.object({
    BR: z.array(nonEmptyString).min(1)
  }),

  companyDocumentTypes: z.object({
    BR: z.array(nonEmptyString).min(1)
  }),

  backend: z.object({
    companyKey: nonEmptyString,
    platform: nonEmptyString,
    otcKycValidityDays: z.number().min(0),

    didit: z.object({
      documentVerificationWorkflowId: nonEmptyString,
      biometricValidationWorkflowId: nonEmptyString,
      documentVerificationValidityDays: z.number().min(0),
      sdkMode: z.literal("modal")
    })
  }),

  endpoints: z.object({
    quoteBaseUrl: z.string(),
    otcViaSameOrigin: z.boolean(),
    customerBaseUrl: z.string(),
    paymentBaseUrl: z.string(),
    orderBaseUrl: z.string(),
    sendEmailUrl: z.string(),
    updateWebhookBaseUrl: z.string()
  })
}).passthrough();

export function validateRuntimeBrandConfig(raw: unknown) {
  const result = runtimeBrandConfigSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Runtime config inválido: ${details}`);
  }

  return result.data;
}
