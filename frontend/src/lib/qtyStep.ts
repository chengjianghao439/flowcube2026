/**
 * 数量输入框的 step（迁移 254 的商品「数量小数」开关）。
 *
 * 只允许整数的商品给 step=1：上下箭头按整数走，桌面端也会把它当整数框，
 * 用户不会误以为小数是合法的；其余商品给 0.01——这只是**录入提示**（一般填两位），
 * 后端并不限制小数位数：系统的最小库存精度是 0.0001。
 *
 * **step 不会阻止用户键入 1.5**——HTML 的 step 只影响微调步长与原生校验，
 * 而本项目用受控输入、不走原生表单校验。真正的拦截在服务端
 * `backend/src/utils/qtyPrecision.js`；这里只是把「这个商品能不能填小数」
 * 提前告诉用户，别把 UI 提示当成校验。
 */
export function qtyStep(allowDecimal?: boolean | null): string {
  return allowDecimal === false ? '1' : '0.01'
}
