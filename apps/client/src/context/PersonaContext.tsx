import React, { createContext, useContext, useEffect, useState } from 'react';
import { type DemoPersona, DEMO_PERSONAS } from '@devcollab/shared';

interface PersonaContextType {
  currentPersona: DemoPersona;
  setCurrentPersona: (persona: DemoPersona) => void;
}

const PersonaContext = createContext<PersonaContextType | null>(null);

export const PersonaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentPersona, setPersonaState] = useState<DemoPersona>(() => {
    try {
      const saved = localStorage.getItem('devcollab_persona_id');
      if (saved) {
        const found = DEMO_PERSONAS.find((p) => p.id === saved);
        if (found) return found;
      }
    } catch {
      // ignore localStorage error in private mode
    }
    return DEMO_PERSONAS[0];
  });

  const setCurrentPersona = (persona: DemoPersona) => {
    setPersonaState(persona);
    try {
      localStorage.setItem('devcollab_persona_id', persona.id);
    } catch {
      // ignore
    }
  };

  return (
    <PersonaContext.Provider value={{ currentPersona, setCurrentPersona }}>
      {children}
    </PersonaContext.Provider>
  );
};

export function usePersona(): PersonaContextType {
  const context = useContext(PersonaContext);
  if (!context) {
    throw new Error('usePersona must be used within a PersonaProvider');
  }
  return context;
}
