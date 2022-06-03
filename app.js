//load the express module
const express = require('express'); // this function returns an object of type express
 
//by convention we call the object app
const app = express();

//adding a piece of middleware to allow us to parse json objects
app.use(express.json());

//an array of course objects
const courses = [
    {id: 1, name: 'Algorithms'},
    {id: 2, name: 'Software Engineering'},
    {id: 3, name: 'Human Computer Interaction'}
    ]
	
//Defining a Route
 
//app.get takes 2 arguments, the first is path/url.
//The second argument is a callback function
//the callback function takes 2 arguments: the request and response
 
app.get('/', function(req, res){  //when we get an http get request to the root/homepage
    res.send("Hello World");
});
 
//when we route to /courses
app.get('/courses', function(req, res){
    res.send(courses); //respond with the array of courses
});

//check if theres the environment variable PORT<br>
const port = process.env.PORT || 3000;
app.listen(port, function(){
    console.log("listening on port " + port)
})