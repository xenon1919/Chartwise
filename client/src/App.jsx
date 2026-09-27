import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Landing from './pages/Landing.jsx';

// The copilot pulls in Plotly, so it loads only when someone steps inside.
const Copilot = lazy(() => import('./pages/Copilot.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/app"
          element={
            <Suspense fallback={<div className="page-loader"><span className="spinner" /></div>}>
              <Copilot />
            </Suspense>
          }
        />
        <Route path="*" element={<Landing />} />
      </Routes>
    </>
  );
}
