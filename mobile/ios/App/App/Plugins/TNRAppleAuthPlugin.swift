import AuthenticationServices
import Capacitor
import Foundation

/// Native Sign in with Apple.
///
/// Guideline 4.8 requires an equivalent login option wherever a third-party social login is
/// offered, and on iOS the system sheet is the only version Apple accepts. This returns the
/// identity token; the WebView exchanges it for a Clerk session with the
/// `oauth_token_apple` strategy, so nothing downstream of the session changes.
@objc(TNRAppleAuthPlugin)
public class TNRAppleAuthPlugin: CAPPlugin, CAPBridgedPlugin,
                                 ASAuthorizationControllerDelegate,
                                 ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "TNRAppleAuthPlugin"
    public let jsName = "TNRAppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
    ]

    private var pendingCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        // The sheet is modal, so a second request while one is open would orphan the first
        // call and leave its promise hanging forever.
        if pendingCall != nil {
            call.reject("A sign-in is already in progress")
            return
        }
        pendingCall = call
        call.keepAlive = true

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            // Apple only ever supplies these on the very first authorisation, and only if
            // the player agrees to share them.
            request.requestedScopes = [.fullName, .email]

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    // MARK: - ASAuthorizationControllerDelegate

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let call = takePendingCall() else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple returned no identity token")
            return
        }

        var result: [String: Any] = [
            "identityToken": identityToken,
            "user": credential.user,
        ]
        if let email = credential.email {
            result["email"] = email
        }
        if let given = credential.fullName?.givenName {
            result["givenName"] = given
        }
        if let family = credential.fullName?.familyName {
            result["familyName"] = family
        }
        call.resolve(result)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        guard let call = takePendingCall() else { return }
        // A cancellation is a dismissal, not a failure; the web side reports the two
        // differently so it can stay quiet when the player simply changed their mind.
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("cancelled", "CANCELLED")
            return
        }
        call.reject("Sign in with Apple failed", nil, error)
    }

    // MARK: - ASAuthorizationControllerPresentationContextProviding

    public func presentationAnchor(
        for controller: ASAuthorizationController
    ) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }

    private func takePendingCall() -> CAPPluginCall? {
        let call = pendingCall
        pendingCall = nil
        call?.keepAlive = false
        return call
    }
}
