// Supporting koipond. The app is free and complete for everyone; paying is optional (pay what you want).
// A purchase comes with a key; pasting it marks this Mac as a supporter, which only stops the
// "pay what you want" card from appearing. Nothing is locked.
//
// No secrets live here: the checkout link is public, and keys are checked against Dodo Payments'
// public license endpoint (no API key needed).
import Foundation

enum Store {
    enum Mode: String { case test, live }

    static let products: [Mode: String] = [
        .test: "pdt_0NsYCacmTCBksDKMSi7PX",
        .live: "",
    ]
    /// Live once a live product id is set. `KOI_STORE=test` forces test mode for development.
    static var mode: Mode {
        if ProcessInfo.processInfo.environment["KOI_STORE"] == "test" { return .test }
        return (products[.live] ?? "").isEmpty ? .test : .live
    }
    static var productID: String { products[mode] ?? "" }
    static var apiBase: URL { URL(string: mode == .live ? "https://live.dodopayments.com" : "https://test.dodopayments.com")! }
    static var checkoutURL: URL {
        let host = mode == .live ? "checkout.dodopayments.com" : "test.checkout.dodopayments.com"
        let back = "https://koipond-demo.vercel.app/?thanks".addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        return URL(string: "https://\(host)/buy/\(productID)?quantity=1&redirect_url=\(back)")!
    }
}

struct Supporter: Codable {
    var key: String
    var instanceID: String
    var email: String
    var since: Date

    static var defaultsKey: String { "supporter.\(Store.mode.rawValue)" }
    static func load() -> Supporter? {
        guard let d = UserDefaults.standard.data(forKey: defaultsKey) else { return nil }
        return try? JSONDecoder().decode(Supporter.self, from: d)
    }
    func save() { if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: Supporter.defaultsKey) } }
}

/// When to show the "pay what you want" card: the first time the app opens, and once more a week later.
enum SupportAsk {
    static let firstSeenKey = "support.firstSeen", askedKey = "support.asked"
    static func due(now: Date = Date()) -> Bool {
        let d = UserDefaults.standard
        if Supporter.load() != nil { return false }
        let first = d.object(forKey: firstSeenKey) as? Date ?? { d.set(now, forKey: firstSeenKey); return now }()
        let asked = d.integer(forKey: askedKey)
        if asked == 0 { return true }
        return asked == 1 && now.timeIntervalSince(first) >= 7 * 86400
    }
    static func markAsked() { let d = UserDefaults.standard; d.set(d.integer(forKey: askedKey) + 1, forKey: askedKey) }
}

enum Activation {
    enum Failure: Error {
        case notFound, inactive, limitReached, wrongProduct, server(Int), network(String)
        var message: String {
            switch self {
            case .notFound: return "That key wasn't found. Check it was pasted in full."
            case .inactive: return "That key has been turned off (for example after a refund)."
            case .limitReached: return "That key is already in use on 5 Macs."
            case .wrongProduct: return "That key is for a different product."
            case .server(let c): return "The key server had a problem (\(c)). Try again in a minute."
            case .network(let t): return "Couldn't reach the key server: \(t)"
            }
        }
    }

    /// Registers this Mac against the key with Dodo Payments' public endpoint.
    static func activate(_ raw: String, done: @escaping (Result<Supporter, Failure>) -> Void) {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        var r = URLRequest(url: Store.apiBase.appendingPathComponent("licenses/activate"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["license_key": key, "name": Host.current().localizedName ?? "Mac"])
        r.timeoutInterval = 20
        URLSession.shared.dataTask(with: r) { data, resp, err in
            let result: Result<Supporter, Failure>
            if let err { result = .failure(.network(err.localizedDescription)) }
            else { result = parse(data ?? Data(), status: (resp as? HTTPURLResponse)?.statusCode ?? 0, key: key) }
            DispatchQueue.main.async { done(result) }
        }.resume()
    }

    static func parse(_ data: Data, status: Int, key: String) -> Result<Supporter, Failure> {
        switch status {
        case 200, 201: break
        case 403: return .failure(.inactive)
        case 404: return .failure(.notFound)
        case 422: return .failure(.limitReached)
        default: return .failure(.server(status))
        }
        struct Body: Decodable {
            struct Product: Decodable { let product_id: String }
            struct Customer: Decodable { let email: String }
            let id: String; let product: Product; let customer: Customer
        }
        guard let b = try? JSONDecoder().decode(Body.self, from: data) else { return .failure(.server(status)) }
        guard b.product.product_id == Store.productID else { return .failure(.wrongProduct) }
        return .success(Supporter(key: key, instanceID: b.id, email: b.customer.email, since: Date()))
    }
}
