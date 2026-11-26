import Contacts
import ExpoModulesCore
import MapKit

/// Apple Maps search for JavaScript. `suggest` is the autocomplete behind Apple Maps' own search
/// box, which copes with half-typed words; `resolve` turns a picked suggestion into places with
/// addresses and coordinates. A suggestion that is itself a search ("Coffee") resolves to several.
/// Every function runs on the main queue, which MapKit's completer needs and which keeps the
/// state below single-threaded.
public class ExpoMapKitSearchModule: Module {
  /// The newest `suggest` call's suggestions, by id, with the area that call searched so a picked
  /// search ("Bookstores") stays in it.
  /// shortcut: only the newest call's list is kept, so an id from an older list is unknown. Matters
  /// if an app shows two suggestion lists at once; keep a small history then.
  private var completions: [String: (MKLocalSearchCompletion, MKCoordinateRegion?)] = [:]
  /// Counts `suggest` calls. Answers arrive out of order while someone types, so only the most
  /// recently started call may replace `completions`.
  private var generation = 0
  /// Completers waiting for results, kept alive until they answer.
  private var running: [String: (MKLocalSearchCompleter, CompleterDelegate)] = [:]

  public func definition() -> ModuleDefinition {
    Name("ExpoMapKitSearch")

    AsyncFunction("suggest") { (query: String, latitude: Double?, longitude: Double?, citiesOnly: Bool, promise: Promise) in
      let key = UUID().uuidString
      self.generation += 1
      let generation = self.generation
      let completer = MKLocalSearchCompleter()
      if citiesOnly {
        completer.resultTypes = [.address]
        if #available(iOS 18.0, *) {
          completer.addressFilter = MKAddressFilter(including: [.locality])
        }
      } else {
        completer.resultTypes = [.pointOfInterest, .address, .query]
      }
      // A region is only a hint, and Apple fills the list with well-known places anywhere. iOS 18
      // adds regionPriority .required, but on iOS 27 the list still included them, so it's set in
      // case it helps and documented as a preference.
      let region = latitude.flatMap { lat in longitude.map { Self.region(lat, $0, meters: 40_000) } }
      if let region {
        completer.region = region
        if #available(iOS 18.0, *) {
          completer.regionPriority = .required
        }
      }
      // Holding self is fine: the delegate is dropped from `running` once it answers or times out.
      let delegate = CompleterDelegate { outcome in
        guard self.running.removeValue(forKey: key) != nil else { return }
        switch outcome {
        case .success(let results):
          // shortcut: a fixed 8 suggestions. Add a limit option when an app needs more.
          let ids = results.prefix(8).map { _ in UUID().uuidString }
          if generation == self.generation {
            self.completions = [:]
            for (id, completion) in zip(ids, results) {
              self.completions[id] = (completion, region)
            }
          }
          let list: [[String: Any]] = zip(ids, results).map { id, completion in
            ["id": id, "title": completion.title, "subtitle": completion.subtitle]
          }
          promise.resolve(list)
        case .failure(let error):
          promise.reject("E_SEARCH_FAILED", error.localizedDescription)
        }
      }
      completer.delegate = delegate
      self.running[key] = (completer, delegate)
      completer.queryFragment = query
      // A completer that never answers (rare) still settles.
      DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
        delegate.finish(.failure(SearchTimeout()))
      }
    }.runOnQueue(.main)

    AsyncFunction("resolve") { (id: String, promise: Promise) in
      guard let entry = self.completions[id] else {
        promise.reject("E_UNKNOWN_SUGGESTION", "That suggestion is no longer available. Ask for suggestions again.")
        return
      }
      let (completion, region) = entry
      let request = MKLocalSearch.Request(completion: completion)
      if let region {
        request.region = region
        if #available(iOS 18.0, *) {
          request.regionPriority = .required
        }
      }
      Self.run(request, limit: 10, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("search") { (query: String, latitude: Double?, longitude: Double?, promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.resultTypes = [.pointOfInterest, .address]
      if let latitude, let longitude {
        request.region = Self.region(latitude, longitude, meters: 60_000)
      }
      Self.run(request, limit: 8, promise: promise)
    }.runOnQueue(.main)

    // The line is thinned to at most 201 points, plenty to draw and small to send across the bridge.
    AsyncFunction("route") { (fromLatitude: Double, fromLongitude: Double, toLatitude: Double, toLongitude: Double, walking: Bool, promise: Promise) in
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: fromLatitude, longitude: fromLongitude)))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: toLatitude, longitude: toLongitude)))
      request.transportType = walking ? .walking : .automobile
      MKDirections(request: request).calculate { response, error in
        if let error, !Self.isNotFound(error) {
          promise.reject("E_SEARCH_FAILED", error.localizedDescription)
          return
        }
        guard let route = response?.routes.first else {
          promise.resolve(nil)
          return
        }
        let count = route.polyline.pointCount
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: count)
        route.polyline.getCoordinates(&coords, range: NSRange(location: 0, length: count))
        let step = max(1, (count + 199) / 200)
        var points = stride(from: 0, to: count, by: step).map { Self.point(coords[$0]) }
        // The last point, unless the stride already landed on it.
        if let last = coords.last, (count - 1) % step != 0 { points.append(Self.point(last)) }
        let result: [String: Any] = ["seconds": route.expectedTravelTime, "meters": route.distance, "points": points]
        promise.resolve(result)
      }
    }.runOnQueue(.main)
  }

  // shortcut: fixed search radii (40 km for suggestions, 60 km for search). Add a radius option
  // when an app needs a neighborhood or a whole country.
  private static func region(_ latitude: Double, _ longitude: Double, meters: Double) -> MKCoordinateRegion {
    MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      latitudinalMeters: meters,
      longitudinalMeters: meters
    )
  }

  /// Runs a search. Apple reports "nothing found" as an error; that's an empty list here.
  private static func run(_ request: MKLocalSearch.Request, limit: Int, promise: Promise) {
    MKLocalSearch(request: request).start { response, error in
      if let error, !isNotFound(error) {
        promise.reject("E_SEARCH_FAILED", error.localizedDescription)
        return
      }
      promise.resolve((response?.mapItems ?? []).prefix(limit).map(place))
    }
  }

  private static func isNotFound(_ error: Error) -> Bool {
    guard let error = error as? MKError else { return false }
    if error.code == .placemarkNotFound || error.code == .directionsNotFound { return true }
    // No route between two points comes back as serverFailure carrying a directions problem
    // (NOT_REACHABLE, FAR_FROM_ROADS), not as directionsNotFound.
    // shortcut: that userInfo key is undocumented (seen on macOS and iOS 27). If a later iOS
    // drops it, unreachable routes reject with E_SEARCH_FAILED instead of resolving null.
    return error.code == .serverFailure && error.userInfo["MKErrorDirectionsErrorInfoKey"] != nil
  }

  private static func point(_ coordinate: CLLocationCoordinate2D) -> [String: Double] {
    ["latitude": coordinate.latitude, "longitude": coordinate.longitude]
  }

  // shortcut: MKPlacemark, MKMapItem(placemark:) and MKMapItem.placemark are deprecated in iOS 26
  // in favour of location, address and addressRepresentations. They still work and don't warn at
  // the pod's 16.4 deployment target. Move to the new API, behind #available, before Apple removes them.
  private static func place(_ item: MKMapItem) -> [String: Any] {
    let placemark = item.placemark
    let address = placemark.postalAddress
      .map { CNPostalAddressFormatter().string(from: $0).replacingOccurrences(of: "\n", with: ", ") } ?? ""
    return [
      "name": item.name ?? "",
      "address": address,
      "latitude": placemark.coordinate.latitude,
      "longitude": placemark.coordinate.longitude,
      "category": item.pointOfInterestCategory?.rawValue ?? "",
      "locality": placemark.locality ?? "",
      "subLocality": placemark.subLocality ?? "",
      "region": placemark.administrativeArea ?? "",
      "country": placemark.country ?? "",
      "countryCode": placemark.isoCountryCode ?? "",
      "url": item.url?.absoluteString ?? "",
    ]
  }
}

struct SearchTimeout: LocalizedError {
  var errorDescription: String? { "Apple Maps didn't answer in time." }
}

/// Hands a completer's first answer to a callback, once. Apple reports "nothing found" as a
/// failure; that's an empty list here.
final class CompleterDelegate: NSObject, MKLocalSearchCompleterDelegate {
  private var done: ((Result<[MKLocalSearchCompletion], Error>) -> Void)?

  init(_ done: @escaping (Result<[MKLocalSearchCompletion], Error>) -> Void) {
    self.done = done
  }

  func finish(_ outcome: Result<[MKLocalSearchCompletion], Error>) {
    let callback = done
    done = nil
    callback?(outcome)
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    finish(.success(completer.results))
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    if let error = error as? MKError, error.code == .placemarkNotFound {
      finish(.success([]))
    } else {
      finish(.failure(error))
    }
  }
}
