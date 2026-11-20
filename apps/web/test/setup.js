import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from '../src/shared/i18n/index.js';

// Pages are lazy-loaded chunks: under the load of the whole suite the first render can exceed 1 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});
