process.env.NODE_ENV ??= 'test';
process.env.PORT ??= 1;
process.env.RESERVATION_TTL_MINUTES ??= 10
process.env.SHIPPING_COST_CENTS_PER_KG_PER_KM ??= '1';
process.env.SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE ??= '15';
process.env.DATABASE_URL ??= "dummy_url_for_unit_tests";