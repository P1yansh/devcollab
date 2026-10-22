import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PersonaProvider } from './context/PersonaContext.js';
import { ProjectDashboard } from './components/Dashboard/ProjectDashboard.js';
import { ProjectView } from './components/Project/ProjectView.js';
import { JoinRedirect } from './components/Project/JoinRedirect.js';

export const App: React.FC = () => {
  return (
    <PersonaProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProjectDashboard />} />
          <Route path="/project/:projectId" element={<ProjectView />} />
          <Route path="/join/:inviteCode" element={<JoinRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </PersonaProvider>
  );
};
