import { AppProviders } from "./components/providers/AppProviders";
import { AppRouter } from "./router";

export default function App() {
  return (
    <AppProviders>
      <div className="page-shell">
        <AppRouter />
      </div>
    </AppProviders>
  );
}
