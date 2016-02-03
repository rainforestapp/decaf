var number = 42;
var opposite = true;
(opposite ? number = -42 : undefined);

var square = function(x) {
  return x * x;
};

var list = [1, 2, 3, 4, 5];

var math = {
  root: Math.sqrt,
  square: square,

  cube: function(x) {
    return x * square(x);
  }
};

var race = function(winner, ...runners) {
  return print(winner, runners);
};

(typeof elvis !== "undefined" && elvis !== null ? alert("I knew it!") : undefined);

var cubes = (list.map(num => {
  return math.cube(num);
}));