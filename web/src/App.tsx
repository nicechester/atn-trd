import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<div>Dashboard - Coming soon</div>} />
        </Routes>
      </div>
    </Router>
  );
}
