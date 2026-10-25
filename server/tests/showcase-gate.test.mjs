import test from "node:test";
import assert from "node:assert/strict";
import { permitsShowcase } from "../../src/showcase/gate.js";
test("临时身份展示仅限独立Pages构建及指定静态入口，正常构建和已配置API均不启用", () => {
  const location = {
    hostname: "crystalclear9.github.io",
    pathname: "/OutdoorsWeb/",
    search: "",
  };
  assert.equal(permitsShowcase("pages", "", location), true);
  for (const mode of ["production", "development", "test"])
    assert.equal(permitsShowcase(mode, "", location), false);
  assert.equal(
    permitsShowcase("pages", "https://api.example.invalid", location),
    false,
  );
  for (const hostname of [
    "example.com",
    "crystalclear9.github.io.attacker.invalid",
  ])
    assert.equal(
      permitsShowcase("pages", "", {
        ...location,
        hostname,
        search: "?showcase=1",
      }),
      false,
    );
  assert.equal(
    permitsShowcase("pages", "", { ...location, pathname: "/AnotherProject/" }),
    false,
  );
  assert.equal(
    permitsShowcase("pages", "", {
      hostname: "127.0.0.1",
      pathname: "/OutdoorsWeb/",
      search: "?showcase=1",
    }),
    true,
  );
  assert.equal(
    permitsShowcase("pages", "", {
      hostname: "127.0.0.1",
      pathname: "/",
      search: "",
    }),
    false,
  );
});
