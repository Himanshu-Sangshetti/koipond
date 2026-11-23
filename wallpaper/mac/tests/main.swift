// Checks for Support.swift (the optional "pay what you want" store). Build and run:
//   swiftc mac/Support.swift mac/tests/main.swift -o build/support-tests && build/support-tests
// KOI_NETWORK=1 also asks Dodo's live key endpoint about a key that does not exist (expects "not found").
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok    \(what)" : "FAIL  \(what)")
    if !ok { failures += 1 }
}
func body(product: String) -> Data {
    try! JSONSerialization.data(withJSONObject: ["id": "lki_test", "product": ["product_id": product], "customer": ["email": "a@example.com"]])
}
func isFailure(_ r: Result<Supporter, Activation.Failure>, _ f: (Activation.Failure) -> Bool) -> Bool {
    if case .failure(let e) = r { return f(e) }
    return false
}

// store config
check(!(Store.products[.live] ?? "").isEmpty, "a live product id is set")
check(Store.mode == .live, "the store is live by default")
check(Store.checkoutURL.absoluteString.hasPrefix("https://checkout.dodopayments.com/buy/\(Store.products[.live]!)"), "checkout link points at the live product")
let back = URLComponents(url: Store.checkoutURL, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "redirect_url" }?.value
check(back == "https://koipond-demo.vercel.app/?thanks", "checkout returns to the thank-you screen")
check(Store.apiBase.absoluteString == "https://live.dodopayments.com", "keys are checked against the live endpoint")
setenv("KOI_STORE", "test", 1)
check(Store.mode == .test && Store.checkoutURL.host == "test.checkout.dodopayments.com", "KOI_STORE=test switches to the test store")
check(Supporter.defaultsKey == "supporter.test", "test and live supporters are stored apart")
unsetenv("KOI_STORE")

// key activation responses
let live = Store.productID
if case .success(let s) = Activation.parse(body(product: live), status: 200, key: " k-1 \n") {
    check(s.key == "k-1" && s.instanceID == "lki_test" && s.email == "a@example.com", "a valid key activates (and is trimmed)")
} else { check(false, "a valid key activates") }
if case .success = Activation.parse(body(product: live), status: 201, key: "k") { check(true, "201 also counts as activated") } else { check(false, "201 also counts as activated") }
check(isFailure(Activation.parse(body(product: "pdt_other"), status: 200, key: "k")) { if case .wrongProduct = $0 { return true }; return false }, "a key for another product is refused")
check(isFailure(Activation.parse(Data(), status: 404, key: "k")) { if case .notFound = $0 { return true }; return false }, "404 means not found")
check(isFailure(Activation.parse(Data(), status: 403, key: "k")) { if case .inactive = $0 { return true }; return false }, "403 means turned off (refund)")
check(isFailure(Activation.parse(Data(), status: 422, key: "k")) { if case .limitReached = $0 { return true }; return false }, "422 means the activation limit is reached")
check(isFailure(Activation.parse(Data("oops".utf8), status: 200, key: "k")) { if case .server = $0 { return true }; return false }, "an unreadable reply is a server error")
check(isFailure(Activation.parse(Data(), status: 500, key: "k")) { if case .server(500) = $0 { return true }; return false }, "500 is a server error")
check(!Activation.Failure.notFound.message.isEmpty && !Activation.Failure.network("x").message.isEmpty, "every failure has a message")

// when the "pay what you want" card shows: first open, once more after a week, never for supporters
let d = UserDefaults.standard
for k in [SupportAsk.firstSeenKey, SupportAsk.askedKey, "supporter.live", "supporter.test"] { d.removeObject(forKey: k) }
let t0 = Date(timeIntervalSince1970: 1_800_000_000)
check(SupportAsk.due(now: t0), "the card shows on first open")
SupportAsk.markAsked()
check(!SupportAsk.due(now: t0.addingTimeInterval(86400)), "not again the next day")
check(SupportAsk.due(now: t0.addingTimeInterval(7 * 86400)), "once more after a week")
SupportAsk.markAsked()
check(!SupportAsk.due(now: t0.addingTimeInterval(60 * 86400)), "never a third time")
d.removeObject(forKey: SupportAsk.askedKey)
Supporter(key: "k", instanceID: "i", email: "e", since: t0).save()
check(Supporter.load()?.key == "k", "a supporter is remembered")
check(!SupportAsk.due(now: t0), "supporters never see the card")
for k in [SupportAsk.firstSeenKey, SupportAsk.askedKey, "supporter.live", "supporter.test"] { d.removeObject(forKey: k) }

// the real endpoint, with a key that does not exist
if ProcessInfo.processInfo.environment["KOI_NETWORK"] != nil {
    let done = DispatchSemaphore(value: 0)
    var result: Result<Supporter, Activation.Failure>?
    Activation.activate("koipond-ci-key-that-does-not-exist") { result = $0; done.signal() }
    while done.wait(timeout: .now() + 0.05) == .timedOut { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
    check(result.map { isFailure($0) { if case .notFound = $0 { return true }; return false } } ?? false, "the live key endpoint answers 'not found' for an unknown key")
}

print(failures == 0 ? "all support checks passed" : "\(failures) support check(s) failed")
exit(failures == 0 ? 0 : 1)
