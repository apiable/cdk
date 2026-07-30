"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRUST_ACCOUNT_PARAMETER = exports.GatewayRoleStack = exports.GatewayRole = void 0;
/**
 * Re-exports the gateway-role construct (packaged as `@apiable/cdk-gateway-role`);
 * standalone CFN synthesis uses `GatewayRoleStack`.
 */
var gateway_role_1 = require("./gateway-role");
Object.defineProperty(exports, "GatewayRole", { enumerable: true, get: function () { return gateway_role_1.GatewayRole; } });
Object.defineProperty(exports, "GatewayRoleStack", { enumerable: true, get: function () { return gateway_role_1.GatewayRoleStack; } });
Object.defineProperty(exports, "TRUST_ACCOUNT_PARAMETER", { enumerable: true, get: function () { return gateway_role_1.TRUST_ACCOUNT_PARAMETER; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2F0ZXdheXJvbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJnYXRld2F5cm9sZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7O0dBR0c7QUFDSCwrQ0FBdUY7QUFBOUUsMkdBQUEsV0FBVyxPQUFBO0FBQUUsZ0hBQUEsZ0JBQWdCLE9BQUE7QUFBRSx1SEFBQSx1QkFBdUIsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUmUtZXhwb3J0cyB0aGUgZ2F0ZXdheS1yb2xlIGNvbnN0cnVjdCAocGFja2FnZWQgYXMgYEBhcGlhYmxlL2Nkay1nYXRld2F5LXJvbGVgKTtcbiAqIHN0YW5kYWxvbmUgQ0ZOIHN5bnRoZXNpcyB1c2VzIGBHYXRld2F5Um9sZVN0YWNrYC5cbiAqL1xuZXhwb3J0IHsgR2F0ZXdheVJvbGUsIEdhdGV3YXlSb2xlU3RhY2ssIFRSVVNUX0FDQ09VTlRfUEFSQU1FVEVSIH0gZnJvbSAnLi9nYXRld2F5LXJvbGUnXG5leHBvcnQgdHlwZSB7IEdhdGV3YXlSb2xlUHJvcHMsIEdhdGV3YXlSb2xlU3RhY2tQcm9wcyB9IGZyb20gJy4vZ2F0ZXdheS1yb2xlJ1xuIl19