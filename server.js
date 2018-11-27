'use strict';


//++++++++++++++++++++++ Application Dependencies+++++++++++++++++++++++++
const express = require('express'); //telling app to use the express library
const superagent = require('superagent');  //telling app to use the superagent proxy
const cors = require('cors');  //telling app to use the CORS library
const pg = require('pg');

require('dotenv').config();    // Load environment variables from .env file

//++++++++++++++++++++++++++ Application Setup+++++++++++++++++++++++++++++
const app = express();
const PORT = process.env.PORT;
app.use(cors());

const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

// API Routes
// app.get('/location', (request, response) => {
//   searchToLatLong(request.query.data) //the clients input that is given to the proxy to talk to the API.
//     .then(location => response.send(location)) //awaits response from superagent before responding to client 
//     .catch(error => handleError(error, response)); //is there is an error it will call this function which return the error message
// })
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movies', getMovies);
app.get('/meetups', getMeetup);
app.get('/trails', getTrails);


app.listen(PORT, () => console.log(`Listening on ${PORT}`));


// Models
function Location(query, res) {
  this.tableName = 'locations';
  this.search_query = query;   
  this.formatted_query = res.body.results[0].formatted_address; 
  this.latitude = res.body.results[0].geometry.location.lat;
  this.longitude = res.body.results[0].geometry.location.lng;
  this.created_at = Date.now();
}

Location.lookupLocation = (location) => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [location.query];

  return client.query(SQL, values)
    .then(result => {
      if (result.rowCount > 0) {
        console.log('We have a match for location');
        location.cacheHit(result);
      } else {
        console.log('We do not have a location match');
        location.cacheMiss();
      }
    })
    .catch(console.error);
}

Location.prototype = {      // Location.prototype.save = function() and so on
  save: function () {
    const SQL = `INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id;`;
    const values = [this.search_query, this.formatted_query, this.latitude, this.longitude];

    return client.query(SQL, values)
      .then(result => {
        this.id = result.rows[0].id;
        return this;
      });
  }
};

function Weather(day) {
  this.tableName = 'weathers';
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
  this.created_at = Date.now();
}

Weather.tableName = 'weathers';
Weather.lookup = lookup;
Weather.deleteByLocationId = deleteByLocationId;

Weather.prototype = {
  save: function (location_id) {
    const SQL = `INSERT INTO ${this.tableName} (forecast, time, created_at, location_id) VALUES ($1, $2, $3, $4);`;
    const values = [this.forecast, this.time, this.created_at, location_id];

    client.query(SQL, values);
  }
}



function Food(place) {
  this.url = place.url;
  this.name = place.name;
  this.rating = place.rating; 
  this.price = place.price;
  this.image_url = place.image_url;
  console.log(this);
}

function Movie(query) {
  this.title = query.title;
  this.released_on = query.release_date;
  this.total_votes = query.vote_count;
  this.average_votes = query.vote_average;
  this.popularity = query.popularity;
  this.image_url = ('http://image.tmdb.org/t/p/w185/'+query.poster_path);
  this.overview = query.overview;
}

function Meetup(meetup) {
  this.link = meetup.link;
  this.name = meetup.name;
  this.host = meetup.host;
  this.creation_date = new Date(meetup.created).toString().slice(0,15);
  }

function Trails(trail) {
  this.trail_url = trail.url;
  this.name = trail.name;
  this.location = trail.location;
  this.length = trail.length;
  this.condition_date = trail.conditionDate;
  this.condition_time = trail.conditionTime;
  this.conditions = trail.conditions;
  this.stars = trail.stars;
  this.star_votes = trail.starVotes;
  this.summary = trail.summary;
}

//+++++++++++++++++++++++++++++ Helper Functions++++++++++++++++++++++++++
function lookup(options) {
  const SQL = `SELECT * FROM ${options.tableName} WHERE location_id=$1;`;
  const values = [options.location];

  client.query(SQL, values)
    .then(result => {
      if (result.rowCount > 0) {
        options.cacheHit(result);
      } else {
        options.cacheMiss();
      }
    })
    .catch(error => handleError(error));
}
// Clear the DB data for a location if it is stale
function deleteByLocationId(table, city) {
  const SQL = `DELETE from ${table} WHERE location_id=${city};`;
  return client.query(SQL);
}

// function searchToLatLong(query) {
//   const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;

//   return superagent.get(url)
//     .then(res => {
//       return new Location(query, res);
//     })
//     .catch(error => handleError(error));
// }

function getWeather(request, response) {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

  superagent.get(url)
    .then(result => {
      const weatherSummaries = result.body.daily.data.map(day => {
        return new Weather(day);
      });
      response.send(weatherSummaries);
    })
    .catch(error => handleError(error, response));
}

function getYelp(req, res){
  const yelpUrl = `https://api.yelp.com/v3/businesses/search?latitude=${req.query.data.latitude}&longitude=${req.query.data.longitude}`;

  superagent.get(yelpUrl)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(yelpResult => {
      const yelpSummaries = yelpResult.body.businesses.map(place => {
        return new Food(place);
      });
      res.send(yelpSummaries);
    })
    .catch(error => handleError(error, res));
}

function getMovies(query,response) {
  const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&query=${query}`;

  superagent.get(movieUrl)
    .then(resultFromSuper => {
      const movieSummaries = resultFromSuper.body.results.map(movieItem => {
        return new Movie(movieItem);
      });
      response.send(movieSummaries);
    })
    .catch(error => handleError(error, response));
}

function getMeetup(request, response) {
  const url = `http://api.meetup.com/find/upcoming_events?lat=${request.query.data.latitude}&lon=${request.query.data.longitude}&key=${process.env.MEETUP_API_KEY}`;

  superagent.get(url)
  .then(result => {
    const meetupListings = result.body.events.map( meet => {
      return new Meetup(meet);
    });
    response.send(meetupListings);
  })
  .catch(error => handleError(error, response));
}

function getTrails(request, response) {
  const trailsUrl = `https://www.hikingproject.com/data/get-trails?lat=${request.query.data.latitude}&lon=${request.query.data.longitude}&key=${process.env.HIKING_API_KEY}`;

  superagent.get(trailsUrl) 
    .then(resultFromSuper => {
      const trailListings = resultFromSuper.body.trails.map(trail => {
        return new Trails(trail);
      });
      response.send(trailListings);
    })
    .catch(error => handleError(error, response));
  }

//+++++++++++++++++++++++++++++++++++++++++Handlers++++++++++++++++++++++++++++++++
  
 // Error handler
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

//location handler
function getLocation(request, response) {
  Location.lookupLocation({
    tableName: Location.tableName,

    query: request.query.data,

    cacheHit: function (result) {
        console.log(result.rows[0]);
      response.send(result.rows[0]);
    },

    cacheMiss: function () {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${this.query}&key=${process.env.GEOCODE_API_KEY}`;

      return superagent.get(url)
        .then(result => {
          const location = new Location(this.query, result);
          location.save()
            .then(location => response.send(location));
        })
        .catch(error => handleError(error));
    }
  })
}

