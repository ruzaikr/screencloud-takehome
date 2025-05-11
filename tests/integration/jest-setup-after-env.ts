import { resetDatabase } from './utils/dbTestUtils';

beforeEach(async () => {
    await resetDatabase();
});
