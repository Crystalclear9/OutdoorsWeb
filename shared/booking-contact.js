// Shared by browser form validation, the static showcase and the real API.
// A landline includes its domestic area code and may include a short extension.
export const BUILDER_PHONE_PATTERN =
  "(?:1[0-9]{10}|0[0-9]{2,3}-?[0-9]{7,8}(?:-[0-9]{1,6})?)";
const builderPhone = new RegExp(`^(?:${BUILDER_PHONE_PATTERN})$`);
export const validBuilderPhone = (value) =>
  typeof value === "string" && value.length <= 25 && builderPhone.test(value);
