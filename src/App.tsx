import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/web" replace />} />
        
        <Route path="/web/*" element={<div className="p-4">LGU Web Dashboard Placeholder</div>} />
        
        <Route path="/mobile/*" element={<div className="p-4">BHW Mobile App Placeholder</div>} />
      </Routes>
    </BrowserRouter>
  );
}