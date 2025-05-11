import { resetDatabase } from './utils/dbTestUtils';

// This will run once before each test file that Jest discovers.
// If you need it before each test case (it block), put the call in beforeEach inside your test files.
beforeEach(async () => {
    await resetDatabase();
});
