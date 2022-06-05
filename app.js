//load the express module
const express = require('express'); // this function returns an object of type express
const { Configuration, OpenAIApi } = require("openai");
 
//by convention we call the object app
const app = express();

//adding a piece of middleware to allow us to parse json objects
app.use(express.json());

const configuration = new Configuration({
    apiKey: process.env.OPEN_AI_API_KEY,
  });
const openai = new OpenAIApi(configuration);
	
//Defining a Route
 
//app.get takes 2 arguments, the first is path/url.
//The second argument is a callback function
//the callback function takes 2 arguments: the request and response
 
app.get('/', function(_, res){  //when we get an http get request to the root/homepage
    res.send("API Version 1.0");
});

const getHaiku = async (req) => {
    const randomSeed = Math.floor(Math.random() * Math.pow(10, Math.floor(Math.random() * 12)));
    let prompt = `${randomSeed}\nWrite a haiku`;
    if(req.body.adjective){
        prompt = `${randomSeed}\nWrite a ${req.body.adjective} haiku`;
    }
    if(req.body.topic){
        prompt += ` about ${req.body.topic}`;
    }
    console.log(prompt);
    const response = await openai.createCompletion("text-davinci-002", {
        prompt: prompt,
        temperature: 0.7,
        max_tokens: 256,
        top_p: 0,
        frequency_penalty: 1,
        presence_penalty: 1,
      });
    if (response.status != 200) {
        return None;
    }
    let haiku = response.data.choices[0].text;
    haiku = haiku.split('\n').slice(-3).join(" / ");
    return haiku;
}
 
//when we route to /courses
app.post('/get-haiku', async (req, res) => {
    /*if(!req.body.name ||
        !req.body.year.toString().match(/^[0-9]{4}$/g) ||
        !req.body.rating.toString().match(/^[0-9]\.[0-9]$/g))
    {
        res.status(400);
        res.json({message: "Bad Request"});
    }*/

    haikus = []
    for (let i = 0; i < 3; i++) {
        const haiku = await getHaiku(req);
        if(!haiku){
            res.send("Could not get a valid response from the AI.");
            return;
        }
        haikus.push(haiku);
    }
    res.send([haikus]); //respond with the array of courses
});

//check if theres the environment variable PORT<br>
const port = process.env.PORT || 3000;
app.listen(port, function(){
    console.log("listening on port " + port)
})