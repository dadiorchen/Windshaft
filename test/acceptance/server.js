var RedisPool = require('redis-mpool');
const MapConfig = require('../../lib/models/mapconfig');
const path = require('path');
var mapnik = require('@carto/mapnik');

const {factory, model} = require("../../lib/index");

const DummyMapConfigProvider = require('../../lib/models/providers/dummy-mapconfig-provider');
const config = {
    millstone: {
        cache_basedir: '/tmp/windshaft-test/millstone'
    },
    redis: {
        host: '127.0.0.1',
        port: 6334,
        idleTimeoutMillis: 1,
        reapIntervalMillis: 1
    },
    renderer: {
        mapnik: {
            grainstore: {
                default_layergroup_ttl: undefined,
                carto_env: {
                    validation_data: {
                        fonts: Object.keys(mapnik.fontFiles())
                    }
                },
                datasource: {
                    geometry_field: 'the_geom',
                    srid: 4326
                },
                cachedir: '/tmp/windshaft-test/millstone',
                mapnik_version: mapnik.versions.mapnik
            },
            mapnik: {
                geometry_field: 'the_geom',
                poolSize: 4,
                poolMaxWaitingClients: 16,
                metatile: 1,
                bufferSize: 64,
                limits: {
                    render: 0,
                    cacheOnTimeout: true
                },
                'cache-features': true,
                metrics: false,
                markers_symbolizer_caches: {
                    disabled: false
                }
            }
        },
        torque: {
            dbPoolParams: {
                size: 16,
                idleTimeout: 3000,
                reapInterval: 1000
            }
        },
        http: {
            timeout: 5000,
            whitelist: ['http://127.0.0.1:8033/{s}/{z}/{x}/{y}.png'],
            fallbackImage: {
                type: 'fs',
                src: path.join(__dirname, '../fixtures/http/basemap.png')
            }
        }
    }
};

var DEFAULT_POINT_STYLE = [
    '#layer {',
    '  marker-fill: #FF6600;',
    '  marker-opacity: 1;',
    '  marker-width: 16;',
    '  marker-line-color: white;',
    '  marker-line-width: 3;',
    '  marker-line-opacity: 0.9;',
    '  marker-placement: point;',
    '  marker-type: ellipse;',
    '  marker-allow-overlap: true;',
    '}'
].join('');

describe("test", () => {

  it.only("test", function(done){
    const mapConfig = {
      version: '1.3.0',
      layers: [
        {
          type: 'mapnik',
          options: {
            sql: "SELECT * FROM trees",
            cartocss: DEFAULT_POINT_STYLE,
            cartocss_version: '2.3.0',
            interactivity: "id",
            attributes: undefined
          }
        }
      ]
    }

    const redisPool = new RedisPool({
      host: "172.17.0.3",
      port: 6379,
      idleTimeoutMillis: 1,
      reapIntervalMillis: 1
    });
    const configCreated = MapConfig.create(mapConfig);
    const rendererOptions = {
      grainstore: config.renderer.mapnik.grainstore,
      renderer: config.renderer.mapnik,
    }

    const mapClientB = factory({
      rendererOptions,
      redisPool,
      onTileErrorStrategy: (...args) => {console.warn("onTileErrorStrategy!",...args)},
    });
    function getTile(z, x, y, options, callback) {
      if (!callback) {
        callback = options;
        options = {};
      }
      var params = Object.assign({
        dbname: 'postgres',
        layer: 'all',
        format: 'png',
        z: z,
        x: x,
        y: y
      }, options);

      if (params.format === 'grid.json') {
        params.token = 'wadus';
      }

      var provider = new DummyMapConfigProvider(configCreated, params);
      mapClientB.tileBackend.getTile(provider, params, function (err, tile, headers, stats) {
        var img;
        if (!err && tile && params.format === 'png') {
          img = mapnik.Image.fromBytesSync(Buffer.from(tile, 'binary'));
        }
        return callback(err, tile, img, headers, stats);
      });
    };

//        getTile(1, 1, 1, (err, tile, img, headers, stats) => {
//          if(err) console.error("err:", err);
//          console.log("result:", tile);
//          done();
//        });
//    return

    console.log("server...");
    this.timeout(1000*60*60*24*7);
    //express server
    const express = require("express");
    var cors = require('cors');
    const app = express();
    app.use(cors());
    app.get("/", async (req, res) => {
      res.send("welcome!");
      //        res.status(200);
    });
    app.get("/:z/:x/:y.png", async (req, res) => {
      const {z,x,y} = req.params;
      console.log("render:",z,x,y);
      const buffer = await new Promise((res, rej) => {
        getTile(z, x, y, (err, tile, img, headers, stats) => {
          if(err) console.error("err:", err);
          res(Buffer.from(tile, 'binary'));
        });
      });
      res.set({'Content-Type': 'image/png'});
      res.end(buffer);
    });
    app.get("/:z/:x/:y.grid.json", async (req, res) => {
      const {z,x,y} = req.params;
      console.log("render grid:",z,x,y);
      const json = await new Promise((res, rej) => {
        getTile(z, x, y, { layer: 0, format: 'grid.json' },(err, tile, img, headers, stats) => {
          console.log("tile:", tile);
          res(tile);
        });
      });
      res.set({'Content-Type': 'application/json'});
      res.json(json);
    });
    app.listen(8000, () => {
      console.log("listening at 8000...");
    });
  });
});
