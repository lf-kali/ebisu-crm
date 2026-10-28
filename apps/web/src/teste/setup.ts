import '../formularios/zod';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { reiniciarSimulacao, servidor } from './servidor';

beforeAll(() => servidor.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => reiniciarSimulacao());
afterEach(() => cleanup());
afterAll(() => servidor.close());

// O roteador restaura a rolagem ao navegar; o jsdom não implementa scrollTo.
window.scrollTo = () => undefined;
