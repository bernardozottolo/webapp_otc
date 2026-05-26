import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { FlowPage } from "../modules/flow/FlowPage";
import { LegalPageView } from "../modules/legal/LegalPageView";
import { OrderStatusPage } from "../modules/order/OrderStatusPage";
import type { BrandConfig } from "../whitelabel/config";
import { applyRuntimeBrandFavicon, applyRuntimeBrandTheme } from "../whitelabel/runtimeConfig";
import type { Country, Locale } from "../shared/types";
import { useI18n } from "../shared/i18n";
import { configureOtcApi } from "../shared/api/client";

interface AppProps {
  brand: BrandConfig;
}

export function App({ brand }: AppProps) {
  const { setLocale } = useI18n();
  const country: Country = brand.defaultCountry;
  const locale: Locale = brand.defaultLocale;

  useEffect(() => {
    setLocale(locale);
  }, [locale, setLocale]);

  useEffect(() => {
    configureOtcApi(brand);
    applyRuntimeBrandTheme(brand);
    applyRuntimeBrandFavicon(brand.faviconUrl);
    document.title = brand.companyName;
  }, [brand]);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <FlowPage
            country={country}
            locale={locale}
            brand={brand}
          />
        }
      />
      <Route path="/order/:id" element={<OrderStatusPage brand={brand} />} />
      <Route path="/:pageSlug" element={<LegalPageView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
