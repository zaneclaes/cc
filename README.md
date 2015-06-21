# Content Carousel

API Endpoints
----
All API requests prefixed by `/api/v#`

* `GET /carousel/:id`: populate and return all sub-streams, gate the StreamItems, and return the results
* `GET /stream/:id`: populate and return a JSON feed of the given stream; keys accepted see `Stream.stream.js`
* `GET /feed/:id`: just return all Content from a given feed (no ingestion)
