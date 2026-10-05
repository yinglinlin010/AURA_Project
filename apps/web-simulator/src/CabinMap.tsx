import { useEffect, useEffectEvent, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  CabinTrip,
  CabinNavigation,
} from "../../../contracts/protocol/src/cabin";
import "maplibre-gl/dist/maplibre-gl.css";
export function CabinMap({
  trip,
  navigation,
}: {
  trip: CabinTrip;
  navigation?: CabinNavigation | undefined;
}) {
  const vehicle = useRef<maplibregl.Marker | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!container.current) return;
    const tiles =
      import.meta.env.VITE_AURA_OSM_TILE_URL ??
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    try {
      const instance = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [tiles],
              tileSize: 256,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [121.53, 25.04],
        zoom: 11,
        attributionControl: { compact: false },
      });
      map.current = instance;
      instance.once("load", () => {
        ready.current = true;
      });
      instance.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
      );
      instance.on("error", () =>
        setError("底圖暫時未載入，路線摘要仍可查看。"),
      );
      return () => {
        vehicle.current?.remove();
        vehicle.current = null;
        instance.remove();
        map.current = null;
        ready.current = false;
      };
    } catch {
      setError("此裝置無法啟動地圖，請使用支援 WebGL 的瀏覽器。");
    }
  }, []);
  const updateTrip = useEffectEvent(() => {
    const instance = map.current;
    if (!instance) return;
    const coordinates = trip.route?.coordinates ?? [];
    const data = {
      type: "FeatureCollection" as const,
      features:
        coordinates.length >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates },
              },
            ]
          : [],
    };
    if (container.current)
      container.current.dataset.routePoints = String(coordinates.length);
    const source = instance.getSource("journey") as
      maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      instance.addSource("journey", { type: "geojson", data });
      instance.addLayer({
        id: "journey-line",
        type: "line",
        source: "journey",
        paint: { "line-color": "#ff6b20", "line-width": 5 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
    }
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    const points = [trip.origin, ...trip.stops, trip.destination].filter(
      (p) => !!p,
    );
    points.forEach((p, i) => {
      const element = document.createElement("span");
      element.className = "cabin-map-marker";
      element.dataset.cabinMarker = "true";
      element.textContent =
        i === 0 ? "起" : i === points.length - 1 ? "終" : String(i);
      element.title = p.name;
      markers.current.push(
        new maplibregl.Marker({ element })
          .setLngLat([p.longitude, p.latitude])
          .addTo(instance),
      );
    });
    const boundsPoints = coordinates.length
      ? coordinates
      : points.map((p) => [p.longitude, p.latitude] as [number, number]);
    if (boundsPoints.length) {
      const bounds = new maplibregl.LngLatBounds();
      boundsPoints.forEach((point) => bounds.extend(point as [number, number]));
      instance.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
    }
  });
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const update = () => updateTrip();
    if (ready.current) update();
    else instance.once("load", update);
    instance.on("resize", update);
    return () => {
      instance.off("load", update);
      instance.off("resize", update);
    };
  }, [trip.version]);
  const updateVehicle = useEffectEvent(() => {
    const instance = map.current;
    if (!instance) return;
    if (!navigation?.position || navigation.status === "stopped") {
      vehicle.current?.remove();
      vehicle.current = null;
      return;
    }
    if (!vehicle.current) {
      const element = document.createElement("div");
      element.className = "cabin-vehicle-marker";
      element.setAttribute(
        "aria-label",
        navigation.mode === "demo" ? "模擬車輛位置" : "GPS 車輛位置",
      );
      vehicle.current = new maplibregl.Marker({ element })
        .setLngLat(navigation.position)
        .addTo(instance);
    }
    vehicle.current.setLngLat(navigation.position);
    if (navigation.status === "active")
      instance.easeTo({ center: navigation.position, zoom: 15, duration: 600 });
  });
  const vehicleLongitude = navigation?.position?.[0];
  const vehicleLatitude = navigation?.position?.[1];
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const update = () => updateVehicle();
    if (ready.current) update();
    else instance.once("load", update);
    return () => {
      instance.off("load", update);
    };
  }, [vehicleLongitude, vehicleLatitude, navigation?.status]);
  return (
    <div className="cabin-map">
      <div
        ref={container}
        className="cabin-map-canvas"
        aria-label="OpenStreetMap 共享行程地圖"
      />
      {error && (
        <p className="cabin-map-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
