import { BrowserRouter as Router } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';

function App() {
  return (
    <Router basename="/">
      <ErrorBoundary>
        {/* Ihre Routes hier */}
      </ErrorBoundary>
    </Router>
  );
} 