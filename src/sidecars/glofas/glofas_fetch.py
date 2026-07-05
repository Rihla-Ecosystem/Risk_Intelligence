import os
import json
import sys
import cdsapi

def main():
    client = cdsapi.Client(
        url=os.environ.get("CDS_API_URL", "https://cds.climate.copernicus.eu/api"),
        key=os.environ["CDS_API_KEY"],
    )

    # Placeholder request — adjust dataset name/params to the specific
    # GloFAS product once the dataset license has been accepted in-browser.
    result = client.retrieve(
        "cems-glofas-forecast",
        {
            "system_version": "operational",
            "hydrological_model": "lisflood",
            "product_type": "ensemble_perturbed_forecasts",
            "variable": "river_discharge_in_the_last_24_hours",
            "area": [32, 24, 21, 37],  # north, west, south, east — Egypt bbox
            "format": "grib",
        },
    )
    result.download("glofas_latest.grib")

    # TODO: parse the GRIB file (e.g. via xarray/cfgrib), threshold against
    # return-period severity, and emit normalized events.
    events = []  # placeholder until GRIB parsing is implemented

    print(json.dumps({"events": events}))

if __name__ == "__main__":
    main()