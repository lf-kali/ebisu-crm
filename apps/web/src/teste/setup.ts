import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { servidor } from './servidor';

beforeAll(() => servidor.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  servidor.resetHandlers();
});
afterAll(() => servidor.close());

// O roteador restaura a rolagem ao navegar; o jsdom não implementa scrollTo.
window.scrollTo = () => undefined;
