const { createStore } = require('./store');
test('saves product with defaultBranch', () => {
  const s = createStore(':memory:');
  const p = s.saveProduct({ name: 'shop', gitUrl: 'https://github.com/x/shop.git', defaultBranch: 'main' });
  expect(p.id).toBeTruthy();
  expect(s.listProducts().length).toBe(1);
});
