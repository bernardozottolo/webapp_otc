import { Navigate, useParams } from "react-router-dom";
import { isLegalPageSlug } from "virtual:legal-pages";

export function LegalPageView() {
  const { pageSlug } = useParams();
  const slug = pageSlug?.trim() ?? "";

  if (!isLegalPageSlug(slug)) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="legal-page-shell">
      <iframe className="legal-page-frame" src={`/legal-pages/${slug}.html`} title={slug} />
    </main>
  );
}
